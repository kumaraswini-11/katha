# ADR-005: Data Persistence & Consistency

## Status

Question approved — answer drafted (under review)

## The Question

How should a microservices system store and access its data — which
databases, owned by whom, accessed how — and how is consistency
maintained across services that cannot share transactions?

### Persistence

1. **Database ownership.** Should all services share a single
   database, or should each service own its own datastore? What are
   the consequences of each — coupling between services,
   independent deployability, transactional boundaries,
   operational cost?

2. **Database type selection.** When is SQL the right choice and
   when is NoSQL? What types of SQL databases exist — relational,
   time-series, graph, search-optimized — and what types of NoSQL
   databases exist — document, key-value, wide-column/column-family,
   graph? Which data shapes and access patterns fit which type?

3. **Access layer: raw queries vs. ORM.** Once a database is chosen,
   should services use raw/native queries or an ORM/data-access
   abstraction? What does each buy and cost — performance, type
   safety, migrations, learning curve, vendor lock-in?

### Cross-service consistency

1. **Consistency patterns.** How is consistency maintained across
   service boundaries that forbid shared transactions — sagas
   (orchestrated vs. choreographed), transactional outbox, inbox
   deduplication, CQRS, eventual consistency? Which pattern fits
   which situation?

---

## Answer

### 1. Database ownership

**Shared database.** One datastore that every service reads and
writes. Its appeal is that everything that was free in a monolith
stays free: `JOIN`s across "modules" are ordinary queries, a
business transaction is one `BEGIN`/`COMMIT` spanning all the
tables it touches, and there is one backup, one migration story, and
one operational surface. The cost is that the database schema
becomes a _shared contract_ — the real integration point of the
system. A column rename in one service's table silently breaks
another service's query; a migration must be coordinated across
every consumer; and the database itself becomes a single point of
contention and failure for the whole system. In microservices terms
this is the textbook "shared database" anti-pattern: you keep the
deployment boundaries on paper while the data layer stays welded
together.

**Database-per-service.** Each service owns its datastore and it is
reachable _only_ through that service's API — the database is part
of the service's implementation, not a shared resource. The
canonical pattern page lays out the enforcement mechanism: grant
each service database credentials that can only touch its own
schema, so the encapsulation is enforced by the database itself
rather than by convention — developers will otherwise always be
tempted to bypass the API and read the tables directly. There is a
spectrum of physical separation, from cheapest to strongest:
_private-tables-per-service_ (same server, disjoint tables),
_schema-per-service_ (same server, one schema each — clearer
ownership), and _database-server-per-service_ (full isolation, for
high-throughput services). Each buys real autonomy: services deploy
and migrate independently, evolve their schemas without
negotiation, scale their storage to their own access pattern, and
choose different database _types_ where their workload demands it —
which is the polyglot-persistence argument for NoSQL alongside SQL.

The mechanism-level consequence is what makes this decision
irreversible in practice: in a shared database, a "join" across
services is a single query; across service boundaries it becomes
N API calls at request time, or a replicated read model maintained
by events. Cross-service transactions that were one ACID commit
become sagas with compensating actions. You are not removing
complexity — you are relocating it from the database (where it was
cheap) into the application layer (where it is expensive and
distributed). That trade is only worth making when the autonomy it
buys is actually needed.

The litmus test: **can service B deploy a schema change without
coordinating a migration with service A?** If not, the boundary is
decorative. And note the legitimate middle ground — a monolith or
modular monolith may share one database across _modules_ because
the modules share one deployable and one team; the rule is "one
database per service," where "service" means an independently
deployable unit with its own consistency boundary, not merely a
folder in a repo.

### 2. Database type selection

The honest answer is that "SQL vs. NoSQL" is the wrong axis — the
real question is _what access pattern and consistency guarantees
does this data need_. The landscape:

**Relational / SQL (OLTP).** PostgreSQL, MySQL and friends remain
the default for business data: structured entities, ad-hoc joins,
secondary indexes, constraints, and ACID transactions. The mechanism
worth understanding is MVCC — multi-version concurrency control:
readers see a consistent snapshot of committed data without taking
locks that block writers, and writers don't block readers. Postgres
implements three effective isolation levels over MVCC (its
"read uncommitted" behaves as read committed), and its isolation
document maps each level to the anomalies it permits — dirty reads,
nonrepeatable reads, phantom reads, and serialization anomalies.
That table is the vocabulary for reasoning about consistency
everywhere else in this ADR. Use relational when data is structured,
relationships matter, integrity constraints are non-negotiable, and
queries are unpredictable — which describes most business domains.

**Time-series (SQL-family).** TimescaleDB (a Postgres extension)
and similar systems optimize for append-mostly, time-ordered data:
automatic time-based partitioning, compression of older chunks,
downsampling via continuous aggregates, and retention policies.
Fit: metrics, IoT telemetry, event logs, anything queried as
"value over time."

**Graph.** Neo4j and peers store data as nodes and relationships
and answer traversal queries — "friends of friends," fraud rings,
org hierarchies, recommendation paths — natively. In relational
databases the same query is recursive self-joins that grow
expensive with depth; in a graph database it is the native
operation. Fit: the _relationships_ are the data.

**Search-optimized.** Elasticsearch/OpenSearch-class engines
provide full-text, fuzzy, and faceted search. In practice they are
almost always a _secondary_ index alongside a system-of-record
database, not the primary store — the source of truth stays in the
OLTP database and the search index is rebuilt from it. Fit:
user-facing search over text-heavy data.

**NoSQL — document.** MongoDB-style stores keep semi-structured
documents (JSON-like) and trade joins for embedding: store the
order _with_ its line items as one document when you always read
them together. Flexible schema suits evolving or heterogeneous
data; horizontal sharding is built in. Cost: no ad-hoc joins, and
schema flexibility can become schema chaos without discipline.
MongoDB's own docs still advertise ACID transactions, but the
multi-document transaction story is newer and narrower than
relational.

**NoSQL — key-value.** Redis, and DynamoDB-style managed stores.
Lookups by key at effectively O(1); minimal query ability — you
get the value for a key, or you don't. Fit: caches, sessions,
leaderboards, queues, simple high-speed lookups. DynamoDB's
documentation is candid about the trade: it supports key-value
_and_ document models, deliberately omits `JOIN`, and pushes you
to denormalize — which is exactly how it delivers single-digit
millisecond reads at massive scale.

**NoSQL — wide-column / column-family.** Cassandra and peers are
built for enormous write throughput: data is partitioned by a
partition key, written across a cluster, and queried primarily by
that key. They offer tunable per-query consistency — quorum reads
and writes let you choose consistency vs. latency _per operation_,
which no single-mode SQL database offers. Fit: telemetry,
time-series at extreme volume, write-heavy workloads where the
partition key matches the access pattern.

**The consistency backdrop.** Brewer's CAP result — later refined
by the PACELC framing — says that during a network partition a
distributed system must choose availability or consistency, and
that even _without_ a partition you trade latency against
consistency. Vogels' "Eventually Consistent" (2008) and
Kleppmann's _Designing Data-Intensive Applications_ are the
canonical treatments. Practical consequence for this question:
NoSQL systems often make that trade _per query_ (Cassandra's
tunability) or _per deployment mode_ (DynamoDB's strongly vs.
eventually consistent reads), while a single-node Postgres gives
you serializable ACID for free — which is why "just use Postgres"
is the correct default until a proven workload demands otherwise.

**Selection rule:** start relational. Add a specialized store only
when a concrete workload proves the relational model is the
bottleneck — a search engine alongside Postgres for text search, a
graph database for traversal-heavy fraud detection, a time-series
store for metrics — never as a wholesale replacement driven by
fashion.

### 3. Access layer: raw queries vs. ORM

An ORM is a bidirectional mapping layer between relational rows and
in-memory objects. Mechanically it provides: object-relational
mapping (tables → classes, rows → objects), an identity map so the
same row maps to the same object within a session, lazy and eager
loading strategies for associations, change tracking / unit-of-work
for writes, and — in mature ecosystems — paired migration tooling
that versions schema changes as code. Fowler's "OrmHate" essay
names the underlying problem precisely: it is really an
_in-memory/relational mapping problem_ — synchronizing two
fundamentally different data representations — and ORMs reliably
handle roughly 80–90% of it.

**What the ORM buys:** dramatically less boilerplate for CRUD;
type safety, especially with code-generating ORMs where the schema
defines the types; managed migrations; database portability _in
theory_; and iteration speed — a new entity is a model class plus a
migration, not hand-written SQL in two directions.

**What it costs — the failure modes that matter:**

- **The N+1 problem.** Lazy loading means accessing an order's
  line items fires one query _per order_ — a list page can
  silently generate hundreds of round trips. The fix (eager
  loading / join fetching) exists in every ORM, but you only
  discover the problem by inspecting generated queries.
- **Hidden SQL.** You no longer see exactly what hits the
  database. ORMs generate queries that are often fine but
  occasionally pathological; the discipline of logging and
  reading generated SQL is non-negotiable in production.
- **Leaky abstraction.** Database-specific power — Postgres
  JSONB operators, window functions, CTEs, partial indexes,
  `EXPLAIN`-driven tuning — fights the abstraction. Fowler's
  verdict: ORMs are a leaky abstraction, but a worthwhile one —
  the mistake is pretending it's 100% when it's 80–90%. Neward's
  famous "Vietnam of Computer Science" essay (2006) is the
  cautionary tale: teams that treat the mapping problem as
  solved-by-framework end up in a quagmire when the last 10%
  demands real relational understanding.
- **Model compromise.** To keep the ORM happy, developers
  flatten or distort the domain model toward the relational
  shape — the tail wagging the dog.
- **Debugging depth.** Stack traces pass through ORM internals;
  "why is this slow" requires understanding both your model and
  the ORM's SQL generation.

**What raw queries buy:** exact control — every statement is
visible, reviewable, and tunable; full access to database-native
features; predictable performance you can verify with `EXPLAIN`;
no abstraction leak. **What they cost:** CRUD boilerplate returns;
mapping rows to objects is manual (or requires a codegen tool like
`sqlc` for type safety); and _you_ own the injection problem —
parameterized queries are mandatory, string-interpolated SQL is a
vulnerability, not a shortcut. Migrations are still your problem
either way.

**The query-builder middle ground** (Knex, Kysely, jOOQ, and
equivalents) is worth naming: it gives typed, composable SQL that
you control statement-by-statement, without full ORM magic — often
the pragmatic choice for services that outgrow raw strings but
don't need object-mapping ceremony.

**The mature answer is hybrid, and the deciding factor is not
ideology but observability:** use the ORM or query builder for
CRUD-heavy paths where its productivity is real, and drop to raw
SQL for hot paths, complex analytical queries, and anywhere the
generated SQL doesn't match the access pattern. Fowler notes one
more asymmetry: for _uni-directional_ (read-only) access the
mapping problem is much simpler — which is part of why CQRS
systems often use simpler data access on the query side.

### 4. Cross-service consistency

Once services own separate databases, the atomicity that `BEGIN`/
`COMMIT` gave you for free is gone. A business transaction spanning
services — reserve credit _and_ create order _and_ notify warehouse
— is now N local transactions separated by network calls, and
partial failure is a normal occurrence, not an edge case. Every
pattern below is a different answer to "how do I make N local
transactions behave like one logical operation?"

**Saga.** From Garcia-Molina & Salem's 1987 paper: a saga is a
sequence of local transactions, each committing in its own
service's database, coordinated so the whole either completes or is
_undone_. The undo is not a rollback — databases can't un-commit —
it is a _compensating transaction_: a new business operation with
opposite effect (refund the charge, release the inventory, cancel
the shipment). Two coordination styles:

- **Orchestrated.** A central coordinator (a state machine,
  often its own service) tells each participant which local
  transaction to run next and tracks saga state. The whole flow
  is visible in one place — easier to reason about, add steps,
  and audit — but every participant couples to the coordinator,
  and the coordinator itself is infrastructure that must be
  reliable (its state must be persisted to survive crashes).
- **Choreographed.** No coordinator: each service publishes a
  domain event when its step completes, and the next service
  reacts to that event. Maximally decoupled — no central point —
  but the flow's logic is scattered across consumers; tracing a
  saga means following events across services; and cyclic event
  dependencies become a real risk.

The deep caveat: sagas provide _no isolation_ — the "I" of ACID.
Concurrent sagas can observe each other's intermediate states and
produce anomalies a single transaction would have prevented;
microservices.io's pattern notes that countermeasures (semantic
locks, commutative updates, reorder-then-process) must be designed
per saga. And there is no automatic rollback — every step's
compensation must be written by hand.

**Transactional outbox.** This solves a narrower but
foundational problem that sagas depend on: how does a service
_atomically_ update its database _and_ publish the event telling
the world about it? Publishing before commit emits phantom events
on rollback; publishing after commit loses the event if the
service crashes in between; and 2PC spanning database and broker
is usually unavailable or undesirable. The outbox pattern makes
the database itself the atomicity mechanism: in the _same_
transaction as the business write, the service inserts a row into
an `outbox` table. A relay process — either a polling publisher or
transaction-log tailing / CDC (e.g., Debezium reading the WAL) —
reads unpublished outbox rows and publishes them to the broker,
then marks them sent. Because the outbox write shares the
business transaction, "state changed" and "event emitted" commit
or roll back together. Ordering is preserved per aggregate
because rows are read in commit order. The cost: one extra table,
a relay component to run, and the guarantee is _at-least-once_
(the relay can crash after publishing but before marking) — which
is exactly why consumers must be idempotent.

**Inbox / idempotent consumer.** Since brokers deliver
at-least-once, every consumer must tolerate duplicates. The
mechanism is a deduplication record _inside the consumer's own
transaction_: before or while applying the business write, insert
the message ID into a `PROCESSED_MESSAGES` table whose primary
key is `(subscriberId, messageID)`. On redelivery the insert
violates the key, the transaction rolls back, and the duplicate
is discarded — the effect is "exactly-once" even though the
transport only promises "at-least-once." (An alternative is
upserting the ID into the business entity itself.) The same
principle applies at API boundaries: idempotency keys on write
endpoints let clients safely retry — AWS's Builders' Library
documents how Amazon makes retries safe by designing APIs to be
idempotent.

**CQRS.** Command Query Responsibility Segregation splits the
model: commands update through a write model that enforces
invariants; queries read from separate, denormalized projections
optimized for the queries they serve — often a different
datastore, kept up to date by subscribing to the domain events the
write side publishes. In a microservice context this is the
standard answer to "how do I run a query that joins data owned by
three services": you don't join — a projection service consumes
the events and materializes the joined view. The cost is the
familiar one: the read model is eventually consistent (replication
lag), so "read your own writes" needs explicit handling — return
the write's result directly, poll, or design the UX around a
"processing" state. Fowler's guidance applies with extra force in
distributed systems: apply CQRS to the bounded contexts that need
it, not the whole system.

**Event sourcing** is the heavyweight adjacent option: persist
state as an append-only event log; the current state is a replay.
It makes "emit event atomically with state change" trivially true
(the event _is_ the state change), gives a perfect audit trail and
temporal queries — but querying current state requires replay or
snapshots, and it almost always drags CQRS along with it. Reserve
it for domains where auditability and time-travel are genuine
requirements.

**Which pattern fits which situation:**

- **Any service that writes state and emits events** →
  transactional outbox. Non-negotiable for reliability; without
  it you will eventually lose or phantom-publish an event.
- **Any event consumer** → idempotent consumer / inbox dedupe.
  Non-negotiable, because at-least-once delivery is the norm.
- **A business workflow spanning multiple services** → saga.
  Orchestrated when the flow is complex, regulated, or needs
  end-to-end visibility (payments, order fulfillment); choreographed
  when it's a simple chain of reactions and loose coupling matters
  more than centralized control.
- **A query that spans services** → CQRS read model / materialized
  view for heavy or async-tolerant reads; API composition (the
  caller joins results from multiple service APIs at request time)
  for simple, low-volume joins that can tolerate the latency.
- **A user flow that genuinely demands strong consistency** →
  reconsider whether it needs to be distributed at all. If the
  operation can't tolerate eventual consistency or compensation,
  the honest answer is often to keep those services' data behind
  one transactional boundary — i.e., don't split what must be
  atomic.

The unifying principle: **choose the consistency level per
operation, not per system.** Not every write needs a saga; not
every read needs a projection. Design the failure semantics first
— what must be atomic, what can be eventual, what the user sees
during the gap — and the patterns above are the toolkit for
implementing exactly that.

### Sources

- Richardson, ["Database per service" (microservices.io)](https://microservices.io/patterns/data/database-per-service.html);
  ["Saga" (microservices.io)](https://microservices.io/patterns/data/saga.html);
  ["Transactional outbox" (microservices.io)](https://microservices.io/patterns/data/transactional-outbox.html);
  ["Idempotent consumer" (microservices.io)](https://microservices.io/patterns/communication-style/idempotent-consumer.html);
  ["CQRS" (microservices.io)](https://microservices.io/patterns/data/cqrs.html);
  ["Event sourcing" (microservices.io)](https://microservices.io/patterns/data/event-sourcing.html)
- Garcia-Molina & Salem, ["Sagas" (1987)](https://www.cs.cornell.edu/andru/cs711/2002fa/reading/sagas.pdf)
- PostgreSQL docs — [MVCC / concurrency control](https://www.postgresql.org/docs/current/mvcc.html),
  [transaction isolation levels](https://www.postgresql.org/docs/current/transaction-iso.html)
- Kleppmann, [_Designing Data-Intensive Applications_](https://dataintensive.net/);
  Vogels, ["Eventually Consistent" (2008)](https://www.allthingsdistributed.com/2008/12/eventually_consistent.html);
  Brewer, ["CAP Twelve Years Later" (2012)](https://queue.acm.org/detail.cfm?id=2462076)
- AWS Builders' Library — ["Making retries safe with idempotent APIs"](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
- Fowler, ["OrmHate" (2012)](https://martinfowler.com/bliki/OrmHate.html);
  ["CQRS" (2011)](https://martinfowler.com/bliki/CQRS.html);
  ["Event Sourcing" (2005)](https://martinfowler.com/eaaDev/EventSourcing.html);
  ["Microservices" (2014)](https://martinfowler.com/articles/microservices.html)
- Neward, ["The Vietnam of Computer Science" (2006)](https://blogs.newardassociates.com/blog/2006/the-vietnam-of-computer-science.html)
- Database documentation — [MongoDB](https://www.mongodb.com/docs/),
  [Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html),
  [Apache Cassandra](https://cassandra.apache.org/doc/latest/cassandra/),
  [Neo4j](https://neo4j.com/docs/),
  [TimescaleDB](https://docs.timescale.com/),
  [Redis](https://redis.io/docs/latest/get-started/)
