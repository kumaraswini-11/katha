# Initial Product Blueprint — Chat Application (draft)

> **Status: Superseded by [blueprint.md](./blueprint.md).** Keep this file only as historical context for how the initial modular-monolith / Next.js / NestJS / Nx exploration evolved into the final Katha architecture.
>
> **Premise:** written as if `docs/research/` were the only thing in
> the repo — the first design thought before any code exists.
> Every choice below cites the research doc or external source that
> justifies it. This is a _draft for review_, not a committed plan;
> approved parts graduate into `docs/specs/<NNN>-*/spec.md`.

---

## 1. Product mental model

A chat application is **real-time conversation infrastructure**.
Strip the UI away and the product is four pipelines:

| Pipeline      | What it does                                         | Hard part                                       |
| ------------- | ---------------------------------------------------- | ----------------------------------------------- |
| **Write**     | Accept a message, persist durably, ack sender        | Ordering + durability under bursts              |
| **Fanout**    | Deliver the message to every recipient's open socket | Connection count × recipients = unicast blow-up |
| **Read**      | History pagination, search, threads, reactions       | Consistent reads of an append-mostly log        |
| **Ephemeral** | Presence, typing, read cursors, notifications        | Correctness without durability                  |

**Core invariants the whole design serves:**

1. **Durability before ack** — a sender sees "sent" only after the
   message is persisted. Never ack-then-write.
2. **Per-conversation total order** — every message gets a
   gap-free `seq` _within its conversation_; clients sort by `seq`,
   never by arrival time or clocks. No cross-conversation ordering
   requirement exists.
3. **At-least-once + idempotent** — delivery may duplicate;
   consumers dedupe on `clientMessageId` / event ids.
4. **Ephemeral ≠ durable** — presence/typing/read-cursors live in
   Redis with TTLs and are _allowed to lie briefly_; messages in
   Postgres must never be lost.
5. **Server is the trust boundary** — clients are untrusted;
   every request and every socket is authenticated and
   authorized at the edge.

**Quality attributes that drive architecture:** latency (<100ms
fanout same-region), ordering correctness, durability, availability
degraded-not-dead, horizontal scale on connections (not just RPS).

---

## 2. Domain decomposition (bounded contexts)

DDD lens — each context owns its data and has one reason to change:

| Context           | Owns                                               | Why it's a boundary                                                         |
| ----------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| **Identity**      | users, credentials, sessions, org membership       | Security-critical, independently auditable; failure must not take chat down |
| **Workspace/Org** | organizations, channels, DM pairs, roles           | tenancy + authorization root; everything references `orgId`                 |
| **Messaging**     | messages, threads, reactions, pins, seq allocation | the hot write path; different scaling profile than everything else          |
| **Realtime**      | WS connections, connection registry, fanout        | holds long-lived state; scales on _connections_, not requests               |
| **Presence**      | online/away/dnd, last-seen, typing                 | ephemeral, high-churn, TTL-driven                                           |
| **Notifications** | push/email/inbox, delivery preferences             | async consumer of domain events; failure-isolated by design                 |
| **Media**         | uploads, avatars, attachments, CDN URLs            | different infra (object storage), different scaling                         |
| **Search**        | message full-text                                  | read-optimized index, rebuilt async from events                             |

Conway check: these map cleanly to team-sized units later
(Team Topologies — research/003). Even solo, the boundaries are
the extraction seams.

---

## 3. Architecture style — the honest answer

**Not microservices on day one. Not a plain monolith either.**

The research (docs/research/003-system-architecture,
001-decision-framework) says: monolith-first, extract on proven
boundaries. Chat breaks that rule in exactly one place — the
**realtime tier**. Long-lived WebSocket connections have an
irreducibly different ops profile (connection count, memory,
regional placement, sticky-ish routing) than request/response
APIs. Slack and Discord both treat gateway/realtime as its own
tier from early on (sources below).

**Recommended shape:**

```text
┌─ apps/web ──────────────── Next.js (App Router, SSR shell)
│
├─ api-gateway ───────────── REST/WS edge: authN, rate limits,
│                            session→claims attestation, /api/auth proxy
│
├─ domain-core (modular monolith) ── Identity + Workspace +
│     Messaging CRUD + history reads. One NestJS deployable,
│     strict internal module boundaries (Nx tags enforce).
│
├─ realtime-gateway ──────── WS termination tier. Holds sockets,
│     connection registry (Redis: user→node), receives fanout
│     commands, pushes to clients. Scales horizontally on
│     connections; stateless except sockets.
│
└─ workers ───────────────── Kafka consumers: notifications,
      search indexing, media processing, event-driven side effects
```

**Why this and not full microservices yet:** the domain core has
real shared-state consistency needs (message write + seq +
membership check in one transaction-ish flow); splitting it early
buys distributed-transaction pain for no scaling benefit at MVP
scale. Extract `messaging-service` later _only when_ the write
path's scaling demands it (hot channels, fanout CPU) — the module
boundary is already drawn.

**Why not serverless:** WS connections and Kafka consumers fight
the FaaS execution model; research/013 covers this — serverless
fits only the media-processing/notification edge functions later.

---

## 4. The hard technical problems (and chosen answers)

### 4.1 Message ordering — the heart of correctness

Within a conversation, `seq` must be gap-free and identical for
every reader. Three known strategies (sources: Irurueta, Ably,
GrowAsEngineers):

| Strategy                                                         | Verdict                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Counter column in conversation row** (transactional increment) | ✅ **Choose for MVP.** Gapless by construction, recoverable from data, no extra moving part. Cost: writers serialize on row lock — fine until a single conversation is genuinely hot.                                       |
| Redis `INCR` per conversation                                    | ⚠️ Fast but burns numbers on failed writes (gaps), needs reseed from DB on failover, two-write disagreement risk. Use only if row-lock contention is _measured_, with DB `last_seq` authoritative and clients gap-tolerant. |
| Single owner/actor per conversation (consistent hash)            | 🔮 Scale answer later — cheapest per message, needs fencing/hand-over. This is the Discord/Slack pattern; adopt when hot channels justify it.                                                                               |

Client contract: optimistic echo in "sending" state → ack delivers
`seq` → message slots into place. Gaps (41 → 44) trigger a
`history?since=` catch-up. `clientMessageId` dedupes retries.

### 4.2 Fanout without unicast blow-up

The scaling trap: 300K-member guild × 10 msg/s = 3M deliveries/s —
one cross-process message per recipient saturates any single
writer (Discord's documented experience).

**Chosen pattern (industry-standard):**

```text
Messaging service validates + persists + assigns seq
      → publishes MessageEvent to Kafka topic per conversation(-partition)
      → fanout workers consume → resolve recipients via
        connection registry (Redis: userId → gatewayNode, TTL+heartbeat)
      → push to gateway node's pub/sub channel (only that node receives)
      → gateway pushes over already-open sockets
```

- **Connection registry in Redis** with TTL + heartbeat — maps
  user → which gateway node holds their socket (System Design
  Atlas pattern). Stale entries expire; clients reconnect.
- **Offline recipients** → message already durable; inbox/push
  path handles notification; on reconnect, `history?since=lastSeenSeq`
  drains the gap. No "missed message" state exists because
  durability precedes delivery.
- **Passive sessions** (connected but tab hidden) → lightweight
  notification payload, not full message (Discord relay pattern).

### 4.3 Realtime transport

- **WebSocket for the live stream only**; REST/HTTP for everything
  else (auth, profiles, history, uploads). Never push everything
  through WS (Stream's explicit warning).
- **Socket.io vs raw `ws`:** Socket.io gives reconnection,
  rooms, and the Redis adapter out of the box — choose it unless
  bundle/protocol control becomes a measured problem. Alternative:
  `ws` + custom protocol + Redis pub/sub adapter (more code,
  more control). Decide at spec time; the registry/fanout design
  is identical either way.
- **Heartbeat + dead-connection detection** mandatory; reconnect
  with jittered backoff; resume via `since_seq` not full reload.
- **Ordering caveat (Ably):** WS ordering guarantees hold only per
  uninterrupted connection — app-level `seq` is the real ordering
  mechanism; transport order is a hint.

### 4.4 Ephemeral state layer

Presence, typing indicators, read cursors — **separate from message
delivery by design** (Stream's layering). Redis with short TTLs;
high churn tolerated; correctness bar is "eventually consistent
within seconds," not durable. Read cursors _do_ get persisted
lazily (they're user-visible state) — but a lost cursor is a UX
annoyance, not data loss.

### 4.5 Data stores

| Store                    | Holds                                                                                             | Why                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL**           | users, orgs, channels, members, messages(+seq), threads, reactions, pins, read cursors            | Relational core; transactions for write path; `seq` counter needs transactional increment                                 |
| **Redis**                | presence, typing, rate-limit counters, session cache, connection registry, pub/sub fanout         | Ephemeral + sub-ms reads; the WS tier's nervous system                                                                    |
| **Object storage + CDN** | media/avatars/attachments                                                                         | Different scaling entirely; signed URLs, never proxy bytes through API                                                    |
| **Kafka**                | domain events (`message.sent`, `message.delivered`, `presence.changed`, `notification.requested`) | Durable event backbone; consumer groups per worker; outbox pattern for DB-write+publish atomicity (research/005, rule 10) |
| **Search index** (later) | message full-text                                                                                 | Postgres FTS → Typesense/Meilisearch/OpenSearch when volume justifies; fed async from Kafka — never on write path         |

Message-table shape note: partition or bucket messages by
`conversation_id` early (research/005 — avoid unbounded-table pain);
hot/cold tiering later if retention demands.

### 4.6 Security & identity

- **Sessions, not JWT-in-JS**: httpOnly `Secure` `SameSite=Lax`
  cookies; server-side session validation at the edge (research/008).
- **Auth provider**: self-hosted Better Auth/Auth.js-style library
  inside the domain core for MVP (users/sessions/orgs in _our_ DB,
  plugin path to SSO later) — vs Keycloak/Auth0 which adds an
  external dependency before product-market fit. Decision recorded
  as reversible.
- **Service trust**: edge attestation pattern — the gateway
  verifies the session once, then passes short-lived signed
  claims (user id, org id, expiry) to internal services over the
  internal transport; services verify the signature locally and
  never trust client-supplied identity headers.
- **E2E encryption — THE product decision, deferred explicitly:**
  - _Server-readable_ (Slack model): enables search, moderation,
    link previews, media scanning. Choose for MVP.
  - _E2E encrypted_ (Signal/WhatsApp model): kills server-side
    search/moderation; huge crypto complexity (key management,
    multi-device, recovery).
  - **Recommendation:** architect the message pipeline so the
    crypto boundary is per-channel/per-org pluggable later —
    store `encryption: "none"|"e2e"` on channel, encrypt payload
    client-side when enabled. Decide with users, not upfront.

### 4.7 Failure & resilience (rule-10 baseline)

- Timeouts on every hop; bounded retries + jitter only for
  idempotent ops; circuit breakers around auth-service, Kafka,
  Redis.
- **Redis down** → presence/typing degrade silently; message
  write path (Postgres) unaffected — verify this isolation is real
  in tests, don't assume it.
- **Kafka down** → writes still succeed (outbox table drains on
  recovery); fanout pauses = messages delayed not lost.
- **Gateway node dies** → its sockets drop; clients reconnect to
  another node; registry TTL expires stale entries; `since_seq`
  resume fills gaps. This is why durability-before-ack is
  non-negotiable.
- DLQ for poison events; structured logs with correlation IDs,
  never tokens/PII.

---

## 5. Technology selections (from research docs)

| Layer     | Choice                                                                                                                                                 | Research basis                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| Repo      | Monorepo, Nx + pnpm workspaces, `apps/*` thin / `libs/*` thick, tag-enforced boundaries                                                                | research/002                     |
| Language  | TypeScript end-to-end (Node/NestJS + Next.js); polyglot only if profiling demands (Go/Rust fanout hot path is the documented upgrade — Discord's path) | research/012                     |
| Frontend  | Next.js App Router + feature libs + shadcn/Base UI + TanStack Query/Zustand                                                                            | research/004                     |
| API style | REST for CRUD/history; WS for live stream; gRPC deferred until a second internal consumer justifies proto toolchain                                    | research/006                     |
| Events    | Kafka (durable backbone, consumer groups) over NATS for the event log; NATS acceptable if ops weight matters more                                      | research/007                     |
| ORM       | Drizzle (SQL-transparent, edge-friendly) — final call at spec time vs Prisma                                                                           | research/005                     |
| Realtime  | Socket.io (batteries) or `ws`+Redis adapter (control) — decide at spec                                                                                 | §4.3                             |
| Auth      | Self-hosted Better Auth-style, httpOnly cookies, org plugin                                                                                            | research/008                     |
| Process   | Spec-driven development per `research/spec-driven-development.md`: spec → plan → journal                                                               | research/spec-driven-development |

---

## 6. Platform & lifecycle decisions

### Repository strategy — monorepo

Chosen: single monorepo — Nx + pnpm workspaces, `apps/*` thin /
`libs/*` thick, tag-enforced module boundaries. Polyrepo rejected
(research/002): shared contracts would need publish/version
overhead, cross-cutting changes (event/proto schema updates)
become multi-repo coordinated releases, and at this team size the
monorepo's atomic-change benefit outweighs its tooling cost.
Revisit only if a component needs a different release cadence or
legal boundary.

### Languages — TypeScript end-to-end (for now)

Frontend: TypeScript/React. Backend: TypeScript/NestJS.
Rationale (research/012): one language = shared contracts/types,
one hiring pool, fastest iteration; the chat domain is
I/O-bound (WS, DB, Kafka) where Node's non-blocking model fits.
**Documented upgrade paths:** fanout hot path → Go/Rust/Elixir if
CPU profiling demands (Discord's path); media transcoding →
whatever its ecosystem favors. Polyglot is a scaling decision,
not a day-one one.

### Databases — summary of §4.5

Postgres (relational core + messages), Redis (ephemeral/registry/
pubsub), object storage + CDN (media), Kafka (events), search
index deferred to async pipeline. Inside the modular monolith:
one Postgres with schema-per-module; per-service databases only
when a service extracts.

### Message broker — Kafka

Kafka over NATS/Redis Streams/SQS for the durable event backbone
(research/007): replayable log, consumer groups, partition
ordering aligns with per-conversation sequencing, ecosystem
maturity. NATS documented as the lighter fallback if ops weight
dominates; Redis is explicitly **not** the broker — it's
cache/registry/pubsub with different failure semantics.

### Communication — three lanes, explicit rules

| Lane                      | Protocol                                                                  | Rule                                                   |
| ------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| Client ↔ edge             | HTTPS REST + WSS                                                          | REST for request/response; WS only for the live stream |
| Service ↔ service (sync)  | REST internal → gRPC when a second consumer justifies the proto toolchain | Sync only when the caller needs the answer _now_       |
| Service ↔ service (async) | Kafka events                                                              | A fact that happened; consumers own their reaction     |

Sync-vs-async rule (research/006): caller can't proceed without
the result → sync; notification that something happened → event;
multi-step workflow with compensation → durable workflow engine
(Temporal-style), not hand-rolled sagas at MVP scale.

### API style — REST + versioning

REST/JSON at the edge (browsers, mobile, third parties); zod
contracts in a shared lib so client and server can't drift.
GraphQL rejected for MVP — chat's access pattern is channel-
scoped feeds, not entity graphs; revisit if query flexibility
becomes a real pain. gRPC internal deferred until ≥2 internal
consumers exist — proto codegen cost isn't justified earlier
(research/006).

### Deployment & environments

- **Packaging:** OCI container image per deployable (web,
  api-gateway, domain-core, realtime-gateway, workers) — build
  once, deploy many (research/013).
- **Orchestration:** managed container platform first (ECS
  Fargate / Cloud Run class); Kubernetes is the documented
  upgrade when scheduling/fleet control is actually needed —
  don't pay K8s complexity before it pays for itself.
- **Environments:** local docker-compose → dev → staging → prod;
  config via validated env vars; secrets via a secrets manager,
  never in the repo.
- **CI/CD:** affected-only lint/typecheck/test/build (Nx
  `affected`); conventional commits feed release versioning;
  GitOps deploy (repo = desired state) when infra lands.

### Observability

OpenTelemetry as the standard (research/010): traces across
client → gateway → service → Kafka (context propagation through
the WS handshake and event headers), RED metrics per service,
USE per infrastructure dependency. Structured logs with
correlation IDs — never tokens/PII. SLOs per pipeline (write
latency, fanout latency, consumer lag) with error budgets driving
alerts, not raw CPU alarms.

### Testing strategy

Test pyramid (research/011): unit-heavy at the domain core;
contract tests at every boundary (claims/metadata contract,
Kafka event schemas); integration tests against real
Postgres/Redis via Testcontainers; a small set of
critical-journey e2e. **Chat-specific invariants that must be
tested:** gap-free `seq` under concurrent sends,
durability-before-ack, resume-after-disconnect with zero loss,
dedupe on retried sends.

---

## 7. Roadmap (spec-driven phases)

Each phase = one or more `docs/specs/` entries; spec.md approved
before plan.md; journal.md records execution.

| Phase                      | Spec scope                                                                                                                                  | Exit criteria                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **0 — Foundation**         | Monorepo scaffold, auth (credentials+OAuth), design system, CI, deploy pipeline                                                             | Sign-up → login → empty shell works e2e                                                      |
| **1 — Messaging MVP**      | Workspaces, channels+DMs, message send/history/reactions, WS live delivery, unread badges                                                   | Two users chat in real time; refresh keeps history; ordering verified under concurrent sends |
| **2 — Realtime hardening** | Connection registry, reconnect/resume (`since_seq`), presence, typing, read cursors                                                         | Kill gateway node mid-chat → clients resume with zero message loss                           |
| **3 — Workspace features** | Org switcher, invites/roles, threads, pins, search (Postgres FTS first)                                                                     | Multi-workspace user journeys complete                                                       |
| **4 — Media + polish**     | Uploads→object storage→CDN, avatars, link previews, notifications (email/push), mobile web                                                  | Media messages render; offline users get notified                                            |
| **5 — Scale & safety**     | Fanout optimization (relay/batching if measured), hot-channel owner pattern, moderation tooling, rate-limit tuning, E2E-encryption decision | Load test at target concurrency passes; ordering/durability drills green                     |

**Explicitly deferred:** E2E encryption, message edit/delete UI,
voice/video, bots/API platform, federation, mobile native apps.

---

## 8. Mental models to keep (the "how to think" list)

1. **Durable log first, delivery second.** The message store is the
   source of truth; sockets are a cache of "who's online right now."
2. **Seq is the product; transport is the hint.** If ordering
   looks wrong, it's a `seq` problem, not a WebSocket problem.
3. **Ephemeral state gets TTLs and permission to lie; durable
   state gets transactions and permission to be slow.** Never mix
   the two failure budgets.
4. **Fanout is a separate scalability axis from ingestion.**
   Design write-path and delivery-path as independently scalable
   pipelines joined by the event log.
5. **The edge authenticates once; the interior verifies
   signatures.** No service re-authenticates, none trusts headers.
6. **Monolith the consistency boundary, microservice the scaling
   boundary.** Extract where load shapes differ — not where org
   charts say so.
7. **Spec before code; journal after.** Every phase above becomes
   a spec folder; nothing gets built without requirements +
   acceptance criteria.

---

## 9. Risks & open questions

| Risk/question                             | Status                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| E2E encryption demand from users          | Deferred decision; architecture keeps the boundary pluggable (§4.6)                      |
| Message retention/legal policy            | Open — affects storage tiering + search scope                                            |
| Target concurrency (10K? 100K sockets?)   | Open — drives whether Phase-2 registry work or Phase-5 relay pattern is needed first     |
| Media abuse (CSAM etc.)                   | Open — needs scanning pipeline decision before public launch                             |
| Mobile push (APNs/FCM)                    | Phase 4 — needs provider accounts early                                                  |
| Regional latency (multi-region gateways?) | Slack goes multi-region for GS; start single-region, design registry to allow it         |
| Cost of Kafka at MVP                      | Mitigation: single-broker KRaft dev; managed Kafka when needed; NATS fallback documented |

## 10. Top pick project ideas for microservice architecture

The best practice projects are ones where microservices aren't optional decoration but forced by the domain.

1. Ride-sharing / food delivery app — `the best overall`
   Driver + customer dual-sided marketplace forces everything: real-time location tracking (WebSocket tier like chat's), geo-spatial queries (PostGIS — polyglot persistence), dispatch/matching engine (event-driven + algorithmic), trip lifecycle with payments (saga: book → charge → complete → payout), surge pricing domain logic. You'd genuinely need 6–8 services: gateway, identity, trip/dispatch, location-ingestion, payments, notifications, ratings.

2. E-commerce marketplace
   Most bounded contexts of any app: catalog, inventory, orders, payments, shipping, reviews, recommendations, notifications. The killer exercise is inventory consistency — preventing overselling across concurrent orders is a textbook saga + outbox + idempotency problem. Downside: it's the most overused tutorial project, so do it with a twist (multi-vendor, auctions, subscriptions).

3. IoT telemetry platform
   Ingest device data → time-series DB (TimescaleDB/InfluxDB — forces a different database than your relational core) → rules engine → alerts → dashboards. Teaches stream processing, polyglot persistence, and async pipelines deeply. Less "business logic" but great systems work.

4. Ticket booking system (movies/events)
   Concurrency king: seat inventory contention, seat-locking with expiry, payment saga, flash-sale load spikes. Small domain, brutal consistency requirements — perfect for learning why "check-then-insert" fails and how idempotency keys save you.

Also strong:

1. **Chat app** (this blueprint) — the realtime/fanout king: WS tiers, connection registries, per-conversation ordering, presence
2. **Streaming platform** — upload → transcode workers → DRM → subscriptions; event-driven heavy
3. **Collaborative editor (Google Docs clone)** — CRDTs + presence; hardest technically, most impressive

### How to actually learn microservices from any of these

The trap is building "microservices" that are really distributed monoliths. Force yourself to:

1. **Start as a modular monolith** — extract only when a boundary _hurts_; this teaches when microservices are actually warranted (see §3)
2. **DB-per-service from the first extraction** — never share tables
3. **Event-driven where it fits** — Kafka/NATS between services, outbox pattern for writes
4. **Deploy each service independently** — separate pipelines, own env vars, own scaling
5. **Contract-test every boundary** — schema registry or Pact-style contracts, so services evolve independently

---

## Sources

**Internal research** (`docs/research/`): 001 decision framework ·
002 repository strategy · 003 system architecture · 004
architectural models · 005 data & consistency · 006 communication &
edge · 007 async infrastructure · 008 security & identity ·
009 resilience · 010 observability · 011 testing · 012 language ·
013 deployment · spec-driven-development.

**External:**

- [Stream — Chat Application Architecture](https://getstream.io/blog/chat-application-architecture/) (edge/transport layering, ephemeral state split, WS-for-live-only)
- [Slack Engineering — Real-time Messaging](https://slack.engineering/real-time-messaging/) (Channel/Gateway/Presence server split, consistent-hash channels, CHARMs)
- [Slack Engineering — Migrating Millions of Websockets to Envoy](https://slack.engineering/migrating-millions-of-concurrent-websockets-to-envoy/) (WS termination tier, multi-region)
- [HLD Handbook — Channel-Scale Chat (Discord/Slack)](https://hld.handbook.academy/curriculum/case-studies/channel-scale-chat/) (fanout blow-up math, relay processes, ScyllaDB, pub/sub→search)
- [System Design Atlas — Chat/Slack](https://systemdesignatlas.dev/docs/02-chat-slack) (connection registry, store-before-ack, inbox_queue + push, since_seq resume)
- [Irurueta — Chat Architecture](https://www.irurueta.com/web/webrtc-websockets/chat-architecture.html) (seq strategies compared, client ordering contract)
- [Ably — Reliable Message Ordering](https://ably.com/blog/chat-architecture-reliable-message-ordering) (WS ordering only per-connection; app-level ordering needed)
- [GrowAsEngineers — Chat App Design](https://growasengineers.com/system-design/design-a-chat-messaging-application/guide) (gap-free conditional-insert sequencing)
