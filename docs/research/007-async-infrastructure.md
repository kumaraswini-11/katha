# ADR-007: Asynchronous Infrastructure — Brokers & Job Processing

## Status

Question approved — answer drafted (under review)

## The Question

What asynchronous infrastructure should carry events and background
work in a microservices system — which message brokers, streaming
platforms, and job-processing mechanisms fit which workloads, and
how should the choice be made?

1. **The broker landscape.** Which message brokers and streaming
   platforms exist — Kafka, RabbitMQ, NATS, Redis Streams, cloud
   queues (SQS, Pub/Sub, Event Hubs), Apache Pulsar, and others?
   What architecture is each built on — log, queue, pub-sub — and
   what workload does each fit?

2. **Delivery semantics.** What do at-most-once, at-least-once, and
   effectively-once delivery actually mean in practice — ordering
   guarantees, deduplication, replay, retention? What do real
   systems actually provide versus what the marketing claims?

3. **Events vs. jobs.** Where do job queues and workflow engines
   fit alongside brokers — Redis-backed queues, durable workflow
   engines, cron/schedulers, serverless queues? What is the
   difference between an "event" and a "job," and does the
   distinction change the infrastructure choice?

4. **Redis's dual role.** Redis can act as a datastore, cache,
   pub/sub layer, stream broker, and queue backend — when does it
   legitimately substitute for a dedicated broker or job system,
   and when does that substitution become a scaling or reliability
   trap?

---

## Answer

### 1. The broker landscape

Async infrastructure falls into three architectural models, and
every product is an elaboration of one (or a hybrid):

- **Log / event streaming** — messages are appended to
  partitioned, ordered logs; consumers track an _offset_ and read
  forward; data is retained by time/size, not by consumption, so
  any consumer group can replay history independently. Kafka,
  Redpanda, AWS Kinesis, Azure Event Hubs, Apache Pulsar.
- **Queue / work queue** — messages sit in queues until a consumer
  takes one and acknowledges it; acknowledged messages are gone.
  Competing consumers share the work. RabbitMQ, AWS SQS, Azure
  Service Bus, Redis lists.
- **Pub/sub subjects** — messages routed by subject/topic to
  interested subscribers; the simplest form is fire-and-forget.
  NATS core, Redis pub/sub, MQTT.

**Kafka** is the reference log implementation. A _topic_ is split
into _partitions_; each partition is an append-only sequence of
immutable log segments replicated across brokers (ISR — in-sync
replicas). Producers pick a partition by hashing the message key,
so all messages for one key land in order on one partition;
consumers in a _consumer group_ split partitions among
themselves, and each group sees the full stream independently at
its own pace. Offsets are committed by the consumer (typically
after processing), retention is time/size-based, and
log-compaction keeps only the latest value per key for
state-like topics. Modern Kafka runs on KRaft (a Raft-based
metadata quorum) instead of ZooKeeper. What it is optimized for:
multi-million-messages-per-second throughput, replay and
reprocessing, fan-out to many independent consumer groups, and
stream processing. What it is _not_: a task queue — there is no
built-in per-message ack, dead-letter queue, or delayed delivery;
those are application patterns built on topics.

**RabbitMQ** implements AMQP 0-9-1: producers publish to
_exchanges_ (direct, topic, fanout, headers), exchanges route via
_bindings_ to _queues_, and consumers pull or receive pushed
messages with a prefetch count. Delivery is at-least-once —
consumers ack, nack (requeue), or reject; unacked messages
redeliver on disconnect; dead-letter exchanges catch poison
messages; TTL + dead-lettering is the standard delayed-retry
pattern. Quorum queues (Raft-replicated) are the current HA answer
(mirrored classic queues are deprecated). MQTT and STOMP adapters
extend it to IoT and simple clients. Optimized for: task/work
distribution, rich routing, per-message semantics, and low-latency
messaging. Limits: no replay of acknowledged messages, and
throughput for wide fan-out trails Kafka.

**NATS** is the lightweight option. Core NATS is pure in-memory
pub/sub over a subject hierarchy (`orders.>`) with built-in
request-reply (inbox + timeout) and queue groups for competing
consumers — at-most-once, no persistence: messages to offline
subscribers are simply lost. JetStream adds the missing half:
_streams_ (per-subject append-only stores on memory or disk),
server-side stateful _consumers_ with explicit acks, redelivery
with backoff, and replay by sequence or time — at-least-once, in a
single Go binary with no external dependencies. It is the right
size for edge/IoT telemetry, service-to-service pub/sub, and
moderate event volumes where Kafka is overkill.

**Redis Streams** (`XADD`/`XREADGROUP`/`XACK`) give Redis a
genuine consumer-group log: entries carry millisecond-sequence
IDs, a pending-entries list tracks unacknowledged messages,
`XAUTOCLAIM` recovers crashed consumers' work, and `MAXLEN`
trimming caps memory. Sub-millisecond latency and zero new
infrastructure if Redis is already deployed — but see §4 for why
it is not Kafka.

**Cloud queues** trade operations for lock-in and per-message
pricing. AWS SQS _standard_ queues are at-least-once with
best-effort ordering; _FIFO_ queues add strict per-message-group
ordering and producer-side deduplication (SHA-256 content hash or
explicit dedup ID within a 5-minute window). Google Pub/Sub is a
global at-least-once service with per-key ordering and an
opt-in exactly-once delivery mode (per-region, pull
subscriptions, per-message-ID ack tracking). Azure Service Bus
offers queues/topics with sessions for ordered processing and
dead-lettering. AWS Kinesis and Azure Event Hubs are sharded
streaming (a shard ≈ 1 MB/s write) aimed at high-volume ingestion,
with Event Hubs speaking the Kafka protocol. **Apache Pulsar**
separates storage (BookKeeper) from brokers, giving built-in
geo-replication and multi-tenancy — powerful but more moving
parts. Managed Kafka (MSK, Confluent Cloud, Event Hubs for
Kafka) removes the broker-ops burden at the cost of the bill.

**Fit:** Kafka-class logs for event streaming, replay, and
fan-out; RabbitMQ/SQS for task queues and work distribution;
NATS/JetStream for lightweight pub/sub and moderate streams;
Redis Streams when Redis is already there and volume is modest;
cloud queues when you want zero broker operations; Pulsar when
geo-replication or multi-tenancy is the hard requirement.

### 2. Delivery semantics

Three claims circulate in marketing; only two survive contact
with distributed systems.

**At-most-once** means the sender does not wait for
acknowledgment: fire-and-forget. NATS core and Redis pub/sub are
at-most-once — a message reaches only subscribers connected at
that instant, and a crash anywhere loses it silently. Correct for
disposable signals (presence pings, cache-invalidation hints);
wrong for anything you cannot afford to lose.

**At-least-once** is the honest default: the broker acknowledges
the producer only after persisting, and the consumer acknowledges
only after processing — so a crash between receive and ack causes
redelivery. Kafka (offset committed after processing), RabbitMQ
(consumer ack), and SQS (delete after processing, visibility
timeout as the lease) all work this way. The corollary every
engineer must internalize: **consumers must be idempotent.** A
payment-processor consumer that charges a card per message will
double-charge on the first redelivery; dedupe by message ID,
idempotency key, or a database unique constraint.

**"Exactly-once"** decomposes into two different claims:

- _Exactly-once delivery_ (broker → consumer, no duplicates) is
  approximated, never absolute. Kafka's "exactly-once semantics"
  (EOS) uses idempotent producers plus transactions: a consumer
  can write output messages and commit its input offset in one
  atomic transaction — but that atomicity holds _inside Kafka_.
  Pub/Sub's exactly-once delivery tracks acknowledgment IDs per
  message and guarantees no redelivery after a successful ack —
  within a region, on pull subscriptions only. SQS FIFO dedup is
  producer-side: it stops duplicates entering the queue, it does
  not stop a consumer from processing the same message twice
  after a crash.
- _Exactly-once processing_ is the goal that actually matters,
  and it is achieved by application design — idempotent consumers
  plus a dedup store — not by broker configuration. The
  transactional outbox (write state + event in one DB
  transaction) and inbox/dedup table on the consumer side are
  the standard mechanisms.

**Ordering** is per-partition (Kafka: same key → same partition →
ordered), per-message-group (SQS FIFO), or per-session (Service
Bus). Global ordering is possible but expensive — one partition
means one consumer's throughput. Real systems deliver
_out-of-order across partitions_, so consumers must tolerate it.

**Replay** is the log's superpower: Kafka consumers re-read from
any offset within retention; JetStream replays by sequence or
time. Queue-based systems (RabbitMQ, SQS) generally cannot replay
acknowledged messages — once consumed, the data is gone unless
you built a parallel archive. Kinesis/Event Hubs replay via
shard iterators within the retention window.

**Real failure modes:** poison messages loop forever without a
DLQ and max-retry policy; consumer lag silently grows when
processing is slower than ingestion; auto-commit offsets can skip
messages on crash (commit _after_ processing); and "at-least-once

- non-idempotent consumer" is the classic double-charge bug.

### 3. Events vs. jobs

The distinction is semantic first, infrastructural second:

- An **event** is an immutable fact — "OrderShipped", "PaymentCaptured".
  It is _broadcast_: many independent consumers may care, each at
  its own pace; it is _retained_ for replay and audit; ordering
  matters per entity (per order), not globally. Infrastructure:
  log brokers — Kafka, Pulsar, Kinesis, JetStream.
- A **job** is a unit of work — "generate the invoice PDF",
  "send the welcome email". It is _claimed_ by exactly one worker,
  leased (visibility timeout), retried with backoff, and its
  result tracked. Infrastructure: work queues — RabbitMQ, SQS,
  Redis lists, cloud task queues.
- A **workflow** is a durable multi-step process — "onboard a
  merchant": provision account → verify documents → schedule
  review → notify, where steps may take days and wait on external
  events. This is neither queue nor log: a durable execution
  engine (Temporal, Cadence, AWS Step Functions, Restate)
  persists the event history; on crash it replays history to
  reconstruct state and resumes at the last completed step, with
  timers, signals, retries, and compensation built in.
- A **scheduler/cron** only _creates_ jobs or events on a clock —
  Kubernetes CronJobs, cloud schedulers (EventBridge, Cloud
  Scheduler), Temporal schedules. It does not process them.
- **Serverless queues** (SQS → Lambda) collapse job processing
  into a managed trigger: scale-to-zero, per-invocation billing —
  ideal for sporadic workloads, bounded by function timeouts and
  cold starts.

Does the distinction change the infrastructure choice? Decisively.
Using a queue as an event log loses replay and fan-out — each
message is consumed once by one worker. Using a log as a job
queue loses per-message semantics — consumer-group offsets march
forward past failures, so DLQ, retry, and result tracking must be
reinvented in application code (retry topics, manual offset
management). The rule: **many independent consumers need the same
data over time → event/log. Exactly one worker should execute each
unit of work → job/queue. A process that must survive crashes and
wait days for input → workflow engine.**

### 4. Redis's dual role

Redis is genuinely good at several async-adjacent jobs — the trap
is treating it as something it is not.

**Legitimate substitutions:**

- **Cache + pub/sub** for ephemeral fan-out — live UI updates,
  presence, invalidation hints. Fire-and-forget is a feature
  here: sub-millisecond latency, and losing a notification is
  harmless because the next state fetch repairs it.
- **Redis Streams** as a lightweight broker for moderate internal
  event processing — consumer groups, explicit acks, replay within
  retention — when the team already runs Redis and volumes stay
  modest. A reasonable Kafka-lite for a single digit-to-low-hundreds
  of thousands of messages per second.
- **List queues** (`LPUSH`/`BRPOP`) for small internal job systems
  — cache warming, digest emails, tooling tasks — where a few
  workers and low stakes make the missing semantics acceptable.
- **Sorted sets** as delayed-job schedulers (score = run-at
  timestamp) or rate limiters — simpler than deploying a
  scheduler for "run this in five minutes."

**Where the substitution becomes a trap:**

- **Durability.** Redis is memory-first. Acknowledged writes can
  be lost on failover — replication to replicas is asynchronous
  unless you use `WAIT` to block until replicas confirm — and
  RDB/AOF persistence has its own loss windows. Eviction policies
  like `allkeys-lru` will silently drop "queued" messages under
  memory pressure. If the data matters enough to need
  Kafka-grade guarantees, it does not belong in Redis.
- **Scale ceiling.** A single Redis node's practical write
  throughput is far below a Kafka cluster's; Streams are
  single-log-per-stream (no partition parallelism); cluster mode
  requires manual resharding and restricts multi-key operations
  to hash slots. You will hit the wall gradually, then all at
  once.
- **Semantic gaps.** Pub/sub drops messages for offline
  subscribers — there is no queue. List-queue pops have no ack:
  a worker that crashes after `BRPOP` loses the job permanently
  (the safe pattern is "ack by removing from a processing list").
  Streams `MAXLEN` trimming destroys history a log would keep.
- **Operational SPOF.** One process, one dataset — Sentinel or
  Cluster adds HA but failover still risks the async-replication
  data loss above.

**Rule of thumb:** Redis for speed and ephemerality — cache,
presence, hints, modest streams, simple internal queues. The
moment you need guaranteed delivery, long retention, replay, or
high fan-out throughput, deploy the dedicated broker. The cost of
Redis-as-broker is not the bill; it is discovering at 3 a.m.
that your "queue" was evicted under memory pressure.

**Bottom line:** choose the model before the product — log for
events and replay, queue for jobs and work distribution,
workflow engine for durable processes. Delivery semantics are
always at-least-once plus consumer idempotency; "exactly-once" is
a marketing term for bounded dedup windows and transactional
scope, not a universal guarantee. Redis accelerates the ephemeral
edges of this world but should never be the system of record for
it.

### Sources

- [Apache Kafka documentation](https://kafka.apache.org/documentation/);
  [Apache Pulsar documentation](https://pulsar.apache.org/docs/);
  [NATS documentation — JetStream](https://docs.nats.io/nats-concepts/jetstream);
  [Redis — Streams](https://redis.io/docs/latest/develop/data-types/streams/);
  [Redis — WAIT command](https://redis.io/docs/latest/commands/wait/)
- [RabbitMQ documentation](https://www.rabbitmq.com/docs);
  [AMQP 0-9-1 specification](https://www.amqp.org/)
- [AWS — Amazon SQS Developer Guide](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html);
  [SQS FIFO queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queues.html);
  [Exactly-once processing in SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html)
- [Google Cloud — Pub/Sub overview](https://cloud.google.com/pubsub/docs/overview);
  [Exactly-once delivery](https://cloud.google.com/pubsub/docs/exactly-once-delivery);
  [Azure Service Bus overview](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-messaging-overview)
- [Temporal documentation](https://docs.temporal.io/);
  [ThoughtWorks Technology Radar](https://www.thoughtworks.com/radar);
  [Confluent — Schema Registry](https://docs.confluent.io/platform/current/schema-registry/index.html)
