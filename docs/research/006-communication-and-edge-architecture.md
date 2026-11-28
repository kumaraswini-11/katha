# ADR-006: Communication Protocols & Edge Architecture

## Status

Question approved — answer drafted (under review)

## The Question

How should services expose and consume functionality — which
communication protocols fit which interactions — and how should the
edge between clients and services be architected?

### Protocols

1. **The protocol landscape.** Which protocols and API styles exist —
   REST/HTTP, gRPC, GraphQL, WebSocket, Server-Sent Events,
   message-based/event-driven communication, batch/file exchange —
   and what is each one optimized for?

2. **Sync vs. async boundary.** Which interactions must be
   synchronous request-response, and which should be asynchronous?
   What determines the choice — user-facing latency, data
   consistency needs, coupling tolerance, failure semantics?

3. **Edge vs. internal protocols.** Should the external-facing API
   protocol differ from internal service-to-service protocols —
   e.g., a gateway exposing REST or GraphQL to clients while
   services speak gRPC internally? When does protocol translation
   at the edge help or hurt?

4. **Contract-first & versioning.** How should contracts be defined
   and versioned per protocol — and what backward-compatibility
   rules apply when a contract evolves?

### Edge & client-facing architecture

1. **Client-facing patterns.** How do BFF (backend-for-frontend),
   API gateway, micro-frontend backends, and GraphQL
   federation/gateways fit into an architecture — when does each
   earn its place between clients and services?

2. **Service discovery.** How do clients and services locate each
   other's instances — DNS, service registries, service mesh —
   and is discovery a communication concern or an infrastructure
   one?

---

## Answer

### 1. The protocol landscape

Every protocol optimizes for a different point on the
latency/throughput/flexibility/operability spectrum. Grouped by
family:

**HTTP request-response.** HTTP/1.1 is text-based: verbose headers
repeated per request, one outstanding request per connection
(pipelining was specified but is effectively dead), and browsers
cap connections at roughly six per host — so parallel calls queue
behind each other (head-of-line blocking). HTTP/2 (RFC 7540) fixes
most of this with a binary framing layer: one TCP connection
carries many multiplexed _streams_ of HEADERS/DATA frames, and
HPACK compresses the repeated headers. The catch: all streams
share one TCP connection, so a single lost packet stalls every
stream — HTTP/3 (RFC 9114) moves the transport to QUIC over UDP,
giving each stream independent loss recovery plus 0-RTT/1-RTT
handshakes. Almost everything on the internet still speaks HTTP
because proxies, firewalls, browsers, and tooling all understand
it.

**REST/OpenAPI.** REST is an architectural style, not a wire
format: resources addressed by URLs, manipulated with verbs
(GET/POST/PUT/PATCH/DELETE), semantics carried by status codes,
contract described by an OpenAPI document (spec.openapis.org).
Strengths: universal tooling (`curl`, browser devtools, every
language's HTTP client), HTTP caching semantics for free,
debuggable by humans. Weaknesses: a composite view needs N calls
(the "chatty API" / client-side N+1 problem), JSON payloads are
verbose, and there is no standard streaming or codegen story.

**gRPC.** gRPC runs on HTTP/2 and uses Protocol Buffers — a
binary wire format where each field is encoded as a _tag_ (field
number shifted left 3 bits OR'd with a wire type, itself a
variable-length integer) plus a value encoded as varint,
fixed32/64, or length-delimited bytes. Field _names_ never go on
the wire — the schema is required to decode, which is why both
sides generate code from the same `.proto` file. Typical
protobuf payloads run several times smaller than the equivalent
JSON, and encoding/decoding is cheaper than JSON parsing. gRPC
supports unary, server-streaming, client-streaming, and
bidirectional RPCs, plus first-class deadlines, cancellation, and
interceptors. Weaknesses: binary is not human-readable (you need
`grpcurl` or a decoder), it requires HTTP/2 end-to-end (some
proxies break it), and browsers can't speak it natively —
gRPC-web or the Connect protocol exists for that. gRPC's natural
home is high-throughput service-to-service traffic inside a
datacenter, not the public internet edge.

**GraphQL.** One endpoint; the client sends a query document
specifying exactly the fields it wants, and the server resolves
each field via per-field resolvers. The schema (SDL) is the
contract, introspection is built in, and persisted queries let
production clients lock down the query shapes they use. The
classic pitfall is the N+1 problem — a query for 100 orders each
needing a `customer` field fires 101 resolver calls unless you
batch with something like DataLoader. GraphQL federation extends
this: each service ("subgraph") owns a slice of the schema tagged
with `@key` entities; a gateway composes the subgraph schemas into
a supergraph at deploy time and its query planner decomposes each
incoming query into parallel subgraph fetches. It buys one unified
API across many teams without one team owning everything — at the
cost of a genuinely complex gateway.

**WebSocket (RFC 6455).** An HTTP request with `Upgrade:
websocket` headers is answered `101 Switching Protocols`, after
which the connection becomes a bidirectional stream of framed
messages (a ~2-byte header per frame) over TCP/TLS. It gives true
full-duplex push but almost no semantics: no reconnection, no
heartbeats, no backpressure contract — application code
implements all of it, and stateful connections complicate
horizontal scaling (fan-out usually needs a pub/sub backplane).
**Server-Sent Events** (WHATWG HTML spec) is the simpler cousin:
plain HTTP, `Content-Type: text/event-stream`, server-to-client
only, `data:`/`event:`/`id:`/`retry:` line protocol, and the
browser's `EventSource` auto-reconnects with a `Last-Event-ID`
header so the server can resume. SSE works through any HTTP
proxy and is the right default for server-push; WebSocket earns
its complexity only when the client must also send high-frequency
messages upstream.

**Message/event-driven.** Broker protocols (AMQP, the Kafka
protocol, NATS, MQTT) are not request-response at all — see
ADR-007 for the deep dive. Protocol-level point: they trade a
synchronous answer for decoupling in time, which changes every
failure mode.

**Batch/file exchange.** Object storage (S3/GCS-style) plus
columnar files (Parquet) or delimited files (CSV) moved via
HTTPS/SFTP for bulk ETL and partner integrations. When throughput
matters more than latency and data volumes are large, this is
cheaper and simpler than streaming millions of API calls.

**Rule of thumb:** gRPC/protobuf for internal typed RPC;
REST/OpenAPI for public and general-purpose APIs; GraphQL when
clients need to dictate response shape across many backends;
SSE for server→client push, WebSocket for true bidirectional;
brokers for anything that can be decoupled in time; files for
bulk.

### 2. Sync vs. async boundary

The boundary is decided by four questions, roughly in order:

1. **Does someone need the answer now?** If a user is staring at
   a spinner, the response _is_ the product — charge
   authorization, search results, a rendered page. If the work is
   a side effect nobody is waiting for — send the receipt email,
   update the search index, notify a webhook — it belongs
   asynchronous.
2. **Does the next step depend on committed state?** If step B
   must see the write from step A, you need either a synchronous
   call or a saga (below). If eventual consistency is acceptable —
   the search index catches up in seconds, the analytics pipeline
   runs nightly — async is safe and cheaper.
3. **How much failure coupling can you afford?** Synchronous call
   chains multiply availability: three hops at 99.9% each compose
   to ~99.7%, and each hop adds its latency to the caller's tail —
   a slow dependency inflates p99 for everyone upstream (timeout
   amplification). An async boundary is a bulkhead: the producer
   succeeds the moment the broker accepts the message, and the
   consumer's problems stay the consumer's problems (retries, DLQ).
4. **What is the workload shape?** Long-running work (>a few
   seconds), fan-out to many consumers, or bursty traffic pushes
   toward async; quick reads and writes stay sync.

The standard escape hatch when you need both: accept the command
synchronously, return `202 Accepted` plus a resource handle, and
let the client poll or subscribe for completion — the "job"
pattern. And when a business operation genuinely spans services
("transfer money between accounts"), you cannot have a
distributed transaction — you use a **saga**: a sequence of local
transactions where each step publishes an event, and failures
trigger compensating actions (reverse the transfer) rather than
rollbacks. The transactional **outbox** pattern pairs with this:
write the state change and the event to the same database in one
transaction, then relay the event — so you never publish an event
for a write that didn't commit.

### 3. Edge vs. internal protocols

The split is real and almost universal in production systems:

- **Edge (client-facing):** REST/OpenAPI or GraphQL for
  browsers, mobile apps, and third parties; SSE/WebSocket for
  realtime; occasionally gRPC-web/Connect for first-party web
  apps. Optimized for: human-debuggable contracts, browser
  compatibility, firewall/proxy traversal, cache-friendliness,
  and slow evolution (public clients can't be force-upgraded).
- **Internal (service-to-service):** gRPC/protobuf when
  throughput and latency matter; plain REST/HTTP is acceptable in
  smaller systems. Optimized for: wire efficiency, typed
  contracts, streaming, and fast iteration (internal consumers
  redeploy with the provider).

Why they differ: the edge and the interior have different
optimization targets and different blast radii. The edge must
survive arbitrary clients and hostile input; the interior can
assume authenticated, well-formed traffic over a trusted network
(plus mTLS — ADR-008). Converging on one protocol usually means
either crippling the interior for the edge's constraints or
exposing interior efficiency to the public.

**Protocol translation at the edge** — the gateway/BFF receives
REST/JSON and calls internal gRPC, or vice versa — helps when:

- clients can't speak the internal protocol (browsers can't do
  native gRPC);
- the internal protocol should be free to evolve without breaking
  published contracts;
- the edge needs to _compose_ several RPCs into one client
  response — translation is really API aggregation.

It hurts when:

- the mapping is lossy — gRPC deadlines, rich status codes, and
  streaming semantics don't survive translation into REST status
  codes and request/response bodies;
- you pay serialize→translate→deserialize at every hop for little
  gain (when both ends could just speak HTTP/2+JSON or connect
  directly);
- the edge schema and internal schema drift silently — two
  contracts to keep compatible instead of one;
- debugging now spans two protocol boundaries (mitigated by
  distributed tracing, but still real).

The practical rule: translate when the client _requires_ it or
when composition demands it; otherwise pass through. A gateway
that only routes and terminates TLS is cheap; a gateway that
re-implements your domain logic in another protocol is a
distributed monolith with extra steps.

### 4. Contract-first & versioning

**Contract-first** means the schema/proto/SDL/OpenAPI document is
written and reviewed _before_ implementation, and both sides
generate code from it — compile-time safety, mock servers for
parallel development, and docs that can't drift from reality.

Compatibility rules differ per protocol because the wire formats
differ:

- **Protobuf/gRPC:** field _numbers_ are the permanent identity —
  never renumber or reuse them; retire fields with `reserved`.
  Adding new fields is wire-safe (old readers skip unknown fields).
  Removing a field or renaming an enum value breaks old readers.
  `buf breaking` and Buf Schema Registry enforce this in CI, the
  same way Confluent Schema Registry enforces Avro/Protobuf/JSON
  Schema compatibility for event contracts.
- **REST/OpenAPI:** additive changes (new endpoints, new optional
  fields) are backward compatible; removing, renaming, or
  retyping fields is breaking. Version via URL (`/v1/`),
  `Accept` media type (`application/vnd.acme.v1+json`), or header
  — pick one and be consistent; use deprecation headers (e.g.,
  `Sunset`) so clients can migrate. Consumer-driven contract tests
  (Pact) verify the provider still satisfies known consumers.
- **GraphQL:** the schema is the contract and is introspectable.
  Adding nullable fields/types is safe; removing fields, adding
  required arguments, or changing nullability is breaking.
  `@deprecated` + `deprecationReason` gives clients a migration
  path; persisted operations lock the query shapes you must
  support.
- **Events:** schema registries with compatibility modes —
  BACKWARD (new code reads old data), FORWARD (old code reads new
  data), FULL (both) — so producers and consumers can deploy in
  either order. Data migrations follow expand→migrate→contract.

The universal rule: **evolve contracts additively, deprecate
loudly, and never break silently.** Once a field name, enum
value, or field number ships, it is public API forever.

### 5. Client-facing patterns

Four patterns sit between clients and services; they solve
different problems and stack:

- **API Gateway** — one entry point that routes by path/host to
  services and absorbs cross-cutting concerns: TLS termination,
  token validation, rate limiting, request shaping. It can proxy
  one-to-one or fan out to compose a response. Popularized by
  Netflix's edge architecture; implementations range from Kong
  and Envoy-based gateways to cloud API gateways. The failure mode
  is the "smart middleware" trap — the gateway accumulates
  business logic and becomes the bottleneck every team must queue
  behind. Keep it thin.
- **BFF (Backend-for-Frontend)** — Sam Newman's 2015 pattern:
  one backend per client _experience_ (desktop web, iOS, Android,
  partner API), maintained by the same team as that UI. Each BFF
  aggregates the multiple service calls a screen needs into
  exactly the shape that client wants — mobile gets fewer fields
  and batched calls; the web app gets richer data. It solves the
  "general-purpose API becomes a bloated, slow-to-release
  bottleneck" problem by letting each client team own its API.
  Cost: N backends to run, and duplicated aggregation logic —
  mitigated by shared client libraries. BFFs must stay
  aggregation-only or they become mini-monoliths.
- **Micro-frontend backends** — the same idea pushed further:
  each independently-deployed frontend module gets its own BFF,
  aligning backend ownership with frontend ownership (module
  federation on the client, one BFF per module on the server).
  Prevents a single gateway from becoming the coordination
  bottleneck; risks chatty per-module backends and duplicated
  auth/aggregation.
- **GraphQL federation/gateway** — many teams each own a
  subgraph: their service plus their slice of the schema. The
  gateway composes subgraph schemas into a supergraph and, per
  query, plans parallel fetches across subgraphs. Solves "one API
  for clients, many owners for services" without a single team
  owning the whole graph. The cost is real: query planning,
  persisted operations, authZ composition, and cross-subgraph
  N+1 all live in the gateway — it is the most complex option
  here and earns its place only at genuine multi-team scale.

**When each earns its place:** a small system with few clients
needs none of this — services expose REST directly. Divergent
client types with different data/latency needs → BFFs. Many
services needing one client-facing API → gateway + federation.
Just traffic management (auth, limits, TLS) → thin gateway.

### 6. Service discovery

The problem: instances are ephemeral — deploys, autoscaling,
crashes — so "where is service X right now" has no stable answer.
Three mechanisms:

- **DNS-based:** Kubernetes `Service` gives a stable virtual IP
  that `kube-proxy` load-balances to healthy endpoints
  (iptables/IPVS/eBPF); a _headless_ service returns pod IPs
  directly so the client load-balances itself; external DNS
  (ExternalDNS, Cloud Map) exposes services outside the cluster.
  Limitation: DNS caching (TTLs) means stale answers during churn,
  and DNS knows nothing about application health beyond endpoint
  presence.
- **Client-side discovery:** the client queries a registry
  (Consul, etcd, Eureka, the Kubernetes API), gets the live
  instance list, picks one (round-robin, least-connections), and
  calls it directly — gRPC's `round_robin`/`pick_first` resolvers
  plus xDS do exactly this. Saves a hop and removes a central LB,
  but every client must implement lookup, health-filtering,
  balancing, and retry — and client versions drift.
- **Server-side discovery:** the client calls a stable virtual
  endpoint and an intermediary resolves and balances — K8s
  Service, cloud load balancers, or a service-mesh sidecar. Clients
  stay dumb; the LB becomes critical infrastructure.
- **Service mesh:** a sidecar proxy (Envoy in Istio/Linkerd)
  intercepts every hop; the control plane pushes the service
  registry, mTLS identities, retries, circuit breaking, and
  telemetry. Discovery, load balancing, and zero-trust identity
  move from application code into the platform layer. Ambient
  meshes (ztunnel/waypoints) reduce the per-pod sidecar cost.
  The price is operational complexity, per-hop latency (typically
  ~1 ms), and a new critical dependency.

**Communication concern or infrastructure?** Both, but mostly
infrastructure: _naming and lookup_ is part of how services
address each other (communication), while health checking, load
balancing algorithms, and mesh telemetry are platform concerns.
The practical stance: applications should never implement
discovery — the platform (Kubernetes, a mesh, or a managed
registry) provides it, and health signals (liveness vs.
readiness vs. load-balancer health checks) keep dead instances
out of the rotation.

**Bottom line:** match protocol to position — REST/GraphQL/SSE at
the edge for clients, gRPC/protobuf inside for efficiency,
brokers for anything decouplable in time, files for bulk. Draw
the sync/async line at "does someone need this answer now and is
the consistency requirement immediate." Keep edge contracts
additive and versioned, internal contracts codegen'd and
schema-checked, and let the platform own discovery.

### Sources

- [RFC 9110 — HTTP Semantics (2022)](https://datatracker.ietf.org/doc/html/rfc9110);
  [RFC 7540 — HTTP/2 (2015)](https://datatracker.ietf.org/doc/html/rfc7540);
  [RFC 9114 — HTTP/3 (2022)](https://datatracker.ietf.org/doc/html/rfc9114);
  [RFC 6455 — WebSocket Protocol (2011)](https://datatracker.ietf.org/doc/html/rfc6455);
  [WHATWG HTML — Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [gRPC documentation](https://grpc.io/docs/);
  [Protocol Buffers](https://protobuf.dev/);
  [GraphQL specification](https://spec.graphql.org/);
  [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [Chris Richardson — API Gateway pattern](https://microservices.io/patterns/apigateway.html);
  Newman, ["Backends For Frontends" (2015)](https://samnewman.io/patterns/architectural/bff/)
- [Kubernetes — Services](https://kubernetes.io/docs/concepts/services-networking/service/);
  [Istio documentation](https://istio.io/latest/docs/);
  [Buf — detecting breaking changes](https://buf.build/docs/breaking);
  [Confluent — Schema Registry](https://docs.confluent.io/platform/current/schema-registry/index.html)
- [ThoughtWorks Technology Radar](https://www.thoughtworks.com/radar)
