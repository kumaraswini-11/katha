# Katha — Blueprint (final decisions)

> **Product:** Katha — real-time workspace chat application.
> Canonical decision record; supersedes `initial-blueprint-draft.md`
> wherever they differ. Inputs: `docs/research/*` +
> `initial-blueprint-draft.md`. Every choice = decision + why +
> rejected alternative + reversal trigger.
> Last verified against official docs/advisories: 2026-11-28.

## Working rules

- **One deployable at a time.** Nothing is scaffolded before its
  step in §10. Infrastructure (Redis, Kafka, object storage, Mongo)
  is added to docker-compose in the step that first needs it.
- **Small, single-purpose commits** (conventional commits).
- **Versions:** latest stable release at the moment a dependency is
  added, at least 7 days old, pinned exactly in the pnpm catalog.
  Security patches are applied immediately.
- **Process (spec-driven, sized to the work):**
  new service or cross-service contract → `spec.md` + `plan.md` +
  `journal.md`; ordinary feature inside one service → short spec
  with acceptance criteria; fix/chore → commit message only.
- **Naming:** `research/00x` = background research documents.
  `D1…D12` (§12) = this project's decisions.

---

## 1. What the product is

```text
        WRITE                FANOUT              READ           EPHEMERAL
   accept→persist→ack   deliver→open sockets  history/threads  presence/typing
   ┌──────────────┐    ┌──────────────────┐  ┌─────────────┐  ┌──────────────┐
   │ ordering +   │    │ conn-count ×     │  │ consistent  │  │ TTL state,   │
   │ durability   │    │ recipients blow- │  │ reads of    │  │ allowed to   │
   │ under bursts │    │ up               │  │ append log  │  │ lie briefly  │
   └──────────────┘    └──────────────────┘  └─────────────┘  └──────────────┘
```

**Invariants:** durability-before-ack · gap-free `seq` per
conversation · at-least-once + dedupe (`clientMessageId`) ·
ephemeral≠durable failure budgets · edge-auth / interior-verify.

---

## 2. The system at a glance

```text
   browser
      │ HTTPS + WSS (one origin)
      ▼
   Caddy (TLS, routing only)
      ├── /            ─▶ web (TanStack Start)
      ├── /api/*       ─▶ api-gateway ──HTTP + signed claims──▶ services
      │                    session check · claims mint · rate limit
      │                    · header hygiene · NO business logic
      │                    /api/auth/* ─▶ auth-service (Better Auth handler)
      └── /ws          ─▶ realtime-service (direct; ticket-authenticated)

   message-service ──write (msg + seq + outbox, one tx)──▶ Postgres
        │ outbox relay publishes MessageSent (key = conversationId)
        ▼
      Kafka ──▶ realtime-service ──registry lookup──▶ Redis pub/sub
        │         (node channel) ──▶ node holding the socket ──▶ client
        ├─────▶ notification-service ──▶ email / push / inbox
        └─────▶ authz caches (fed by workspace-service events, §4)

   service ──gRPC (rare, sync)──▶ service
   media-service: client ⇄ object storage via signed URLs; BullMQ transcode
```

**9 deployables:** `web` · `api-gateway` · `auth-service` ·
`user-service` · `workspace-service` · `message-service` ·
`realtime-service` · `notification-service` · `media-service`

Future: `payment-service`, `ai-service` (documented triggers only).

---

## 3. Service boundaries — why each exists

| Service              | Owns                                                           | Driver (why separate)                                            |
| -------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| api-gateway          | Edge proxy, session check, claims, rate limits                 | Single trust boundary                                            |
| auth-service         | Identity only: credentials, sessions, OAuth accounts, email    | **Security isolation** — failure ≠ chat down                     |
| user-service         | Display name, avatar, settings, preferences                    | **Hot read path**; different lifecycle than credentials          |
| workspace-service    | Workspaces, members, roles, invitations, channels, permissions | **Authz data owner** — 4 services consume it (§4)                |
| message-service      | Messages, threads, seq, history, reactions, FTS                | **Core write path** — owns ordering invariant                    |
| realtime-service     | Sockets, registry, fanout, presence, typing                    | **Connection-count scaling** ≠ request scaling; own blast radius |
| notification-service | Email/push/inbox, delivery preferences                         | **Failure isolation** — async, DLQ-safe                          |
| media-service        | Uploads, storage, transcode, CDN                               | **Bandwidth/CPU profile** — media failure never blocks send      |

**Deviation (recorded):** draft said modular monolith → chose
microservices day-one for the learning objective. Risk: distributed
monolith if boundaries slip — mitigated by DB-per-service + this
table as contract.

### Membership has exactly one owner

Workspace membership, roles and invitations live **only** in
workspace-service. The Better Auth organization plugin is **not**
used. Why: (a) two owners of membership = two sources of truth;
(b) Better Auth offers no hook that runs inside its own write
transaction, so auth-service cannot write an outbox row atomically
— it must not be a source of domain events other services depend on.

Consequences:

- Claims carry no workspace/org. The workspace comes from the
  request path and is authorized via §4.
- Invitation emails: workspace-service emits `InvitationCreated`
  → notification-service sends.
- auth-service publishes nothing that must be reliable.
  user-service creates a profile **lazily** on the first
  authenticated request (from `sub` + `email` in the claims), so
  no `UserRegistered` event is required.

### Field ownership: auth vs user

| Field                                  | Owner        |
| -------------------------------------- | ------------ |
| email, email-verified, password, OAuth | auth-service |
| display name, avatar, settings, theme  | user-service |

### Why auth ≠ user (the split, justified)

```text
Q1 Security/compliance driver?        → YES — credentials vs profile
                                        data; auth hardens independently
Q2 Divergent scaling profile?         → YES — session checks on every
                                        call vs rare profile writes;
                                        profile reads are the hottest path
Q3 Team ownership boundary?           → NO  (solo dev — noted honestly)
Q4 God-service risk (>15–25 endpoints)? → borderline — settings surface
                                        grows; split keeps each focused
```

First YES wins → **separate**. Honest framing: for a real
early-stage product, combining auth+user into one service is the
_correct_ simpler call — this split is a deliberate simulation of
the enterprise boundary the project exists to demonstrate, and the
reversal conditions are documented (D2). The claim isn't
"microservices are always better" — it's "I know the trade-off,
the trigger conditions, and chose deliberately."

---

## 4. Authorization — PEP/PDP (the hard boundary)

```text
workspace-service ──owns──▶ workspaces/members/roles/channels (Postgres)
        │ outbox → compacted topic `authz.membership`
        │          (key = scope:user, value = versioned permission bitmask)
        ▼
      Kafka ──▶ each consuming service keeps its own cache in Redis
        │        (own key prefix + own Redis ACL user)
        ▼
   shared @katha/authz lib evaluates locally — no sync hop on a cache hit
```

- **Bootstrap / rebuild:** replay the compacted topic from offset 0.
- **Cache miss:** gRPC `CheckAccess` to workspace-service, then
  cache the answer. This is the one sync authz hop.
- **workspace-service down:** serve cached entries until TTL, then
  **fail closed**.
- **Revocation lag:** sub-second in the normal case (event
  propagation); bounded by the cache TTL in the worst case.

**Why split:** membership data has 4 consumers (message, realtime,
media, notification) → one owner + event-fed caches beats embedded
copies. Precedent for a separate authorization service: Rocket.Chat
`authorization-service`.
**Costs:** channel metadata denormalized; revocation lag as above.
**Reversal:** D3.

---

## 5. Data per service

```text
Postgres+Drizzle ─ auth · user · workspace · message · notif-log · media-meta
                   (one server, one database + one least-privilege
                    DB user per service; no cross-database queries)
MongoDB (native) ─ notification inbox ONLY — confirm at Phase 3 (D6)
Redis ──────────── realtime registry/presence/typing/pubsub · authz caches
                   · BullMQ · rate limits · session cache
                   (one instance; key prefix + ACL user per service)
Object storage ─── S3 API via AWS SDK; media bytes never pass through APIs.
                   MinIO is NOT usable (community edition archived Feb 2026,
                   images removed Sept 2026). Engine chosen at Phase 4;
                   leading candidate SeaweedFS (D11)
Kafka ──────────── domain events (message.sent, authz.*, notification.*)
BullMQ ─────────── jobs (email, transcode, schedules — consumed once)
```

**Ordering:** `seq` = counter column per conversation (transactional,
gapless). Client: optimistic echo → ack `seq` → slot in; gaps →
`history?since=`; `clientMessageId` dedupes.

**Outbox:** row written in the same transaction as the business
write; a polling relay (`FOR UPDATE SKIP LOCKED`) publishes with
Kafka key = aggregate id, so per-conversation order is preserved.
Only services that own their transactions use it (not auth-service).

---

## 6. Communication — 3 lanes + jobs

```text
client ──HTTPS REST──▶ api-gateway ──HTTP proxy + claims header──▶ service REST
client ──WSS────────▶ realtime-service (direct, §7 ticket)
service ──sync (rare)──▶ gRPC (claims in metadata)
service ──async (facts)─▶ Kafka events
scheduled/retryable ────▶ BullMQ jobs
```

**The gateway does not translate protocols.** It proxies HTTP to
each service's own REST API. Reason: a translating gateway must be
edited and redeployed for every new endpoint — the lockstep-deploy
symptom of a distributed monolith (research/003, research/006).
gRPC is used only where one service calls another.

Rule: needs answer now → sync; fact happened → event; multi-step
workflow w/ compensation → **saga** (choreographed via Kafka
events at MVP; Temporal-style engine only if workflows grow).

**Idempotency everywhere:** `clientMessageId` on sends, idempotency
keys on jobs/webhooks, unique constraints — never check-then-insert.
Consumers assume at-least-once; inbox/dedupe on the receiving side.

**Send path:** client → gateway → message-service → Postgres
(message + seq + outbox) → ack → `MessageSent` → realtime-service
consumes (one consumer group) → registry lookup → publish to the
owning node's Redis channel → socket push. Presence/typing stay in
Redis pub/sub (never Kafka — ephemeral).

**Contracts:** zod schemas in a shared lib for REST; `.proto` for
gRPC and Kafka event payloads, with breaking-change checks in CI.
gRPC toolchain is chosen at the first service-to-service call
(Phase 1) against then-current docs.

---

## 7. Security

```text
browser cookie (httpOnly, Secure, SameSite=Lax; one origin via Caddy)
   ─▶ gateway: strips inbound `authorization` + `x-katha-*`
   ─▶ verifies session with auth-service (short Redis cache)
   ─▶ mints claims JWT {sub, email, sid, aud, iat, exp≈60s, v}
      signed EdDSA — private key ONLY in the gateway
   ─▶ `x-katha-claims` header (HTTP) / metadata (gRPC)
   ─▶ every service verifies signature + aud + exp locally with the
      public key · reject = 401 / UNAUTHENTICATED
```

- **Asymmetric on purpose:** a compromised service cannot forge
  identities, because it only holds the public key.
- **WebSocket:** client calls `POST /api/realtime/ticket` (through
  the gateway) → receives a single-purpose claims token (`aud =
  realtime`, short TTL) → opens `/ws` with it → realtime-service
  verifies locally. No cookie parsing and no auth-service call on
  the socket path.
- Authentication at the edge; **authorization at the resource**
  (§4), in every service.
- Secrets via validated env only · least-privilege DB user per
  service · never log tokens/PII.
- Not in scope now: mTLS between services (single-host compose
  network). Revisit with multi-host deployment.

---

## 8. Resilience (everywhere)

```text
timeouts all hops · retries+jitter idempotent-only · breakers on
auth/Kafka/Redis · outbox for write+event atomicity · DLQ poison msgs
Redis↓ → presence/authz-cache degrade, writes survive
Kafka↓ → outbox drains on recovery, fanout delayed-not-lost
realtime-node↓ → sockets drop → reconnect → since_seq resume = 0 loss
workspace↓ → authz stale-while-error (TTL) → writes fail closed after
auth↓ → existing sessions served from gateway cache until TTL; no new logins
```

---

## 9. Deployment

```text
local:    docker-compose, grown step by step (§10)
showcase: Oracle Always Free VM — ARM, 2 OCPU / 12 GB (allowance was
          halved in June 2026). Full stack + Caddy TLS + DuckDNS.
          Requires explicit memory limits per container (Kafka heap,
          Postgres, Redis maxmemory, Node --max-old-space-size).
          A written memory budget is an exit criterion of Phase 5.
          Everything is served from one origin (cookies).
rejected: Render/Railway/Fly free tiers (spin-downs, expiring DBs, no Kafka)
          K8s deferred until fleet-control needed
```

Images: multi-stage, non-root, built for `linux/arm64` + `linux/amd64`.

---

## 10. Roadmap — one step at a time

Each step is its own spec (where §Working rules requires one) and
its own series of commits. A step starts only when the previous
one meets its exit.

| Step | Adds                                                                                            | Infra added    | Exit                                       |
| ---- | ----------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------ |
| 0.1  | Repo: Turborepo + pnpm catalog + Biome + `turbo boundaries` + shared config/contracts libs + CI | —              | lint/typecheck/boundaries/test green in CI |
| 0.2  | auth-service (Better Auth, email+password, sessions)                                            | Postgres       | signup/login via direct HTTP               |
| 0.3  | api-gateway (proxy, session check, claims mint, rate limit)                                     | Redis          | claims verified by a test service          |
| 0.4  | web shell (TanStack Start, design system, auth screens)                                         | Caddy (local)  | signup → login → empty shell, e2e          |
| 1.1  | workspace-service (workspaces, members, roles, channels)                                        | —              | create workspace + channel, invite member  |
| 1.2  | message-service (send, seq, history, reactions, outbox)                                         | Kafka          | gap-free seq under concurrent sends        |
| 1.3  | realtime-service (ws, ticket auth, fanout)                                                      | —              | 2 users chat live                          |
| 1.4  | user-service (profile, settings; lazy provisioning)                                             | —              | names/avatars render from user-service     |
| 2    | Realtime hardening: registry, resume, presence, typing, authz caches (§4)                       | —              | kill a realtime node → 0 message loss      |
| 3    | notification-service: BullMQ email + inbox                                                      | Mongo (if D6)  | offline users notified                     |
| 4    | media-service: uploads → object storage → CDN, transcode, limits                                | Object storage | all file types work                        |
| 5    | Scale & safety: observability stack, load test, moderation, SLOs, showcase deployment           | OTel backend   | drills green; memory budget fits 12 GB     |

Until Phase 2 lands the authz caches, services authorize with the
gRPC `CheckAccess` call directly (correct first, fast second).

Deferred: E2E encryption (pluggable per-channel), payments, AI,
voice/video, bots, federation, native mobile, search service, K8s.

---

## 11. Stack decisions (one line each)

| Choice                           | Why                                                                                | Rejected                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Turborepo over Nx                | framework-agnostic, native `turbo boundaries` tags, zero ESLint overhead           | Nx (ESLint+Prettier first-class; heavy), polyrepo (coord cost) |
| pnpm + catalog                   | strict isolation, single-version policy                                            | Bun (maturing workspaces)                                      |
| Fastify v5 over Express / NestJS | explicit, built-in Pino JSON logs, native Zod type-provider, `@fastify/http-proxy` | Express 5 (manual validation/logging), NestJS (heavy DI)       |
| TanStack Start                   | typed routes, Vite loop, SSR when needed; SEO irrelevant behind auth               | Next.js (SSR dead weight), Vite+RR (fallback)                  |
| Biome (pure, no ESLint/Prettier) | single Rust tool for all lint/format; `turbo boundaries` handles module boundaries | ESLint+Prettier; dual Biome+ESLint hybrid                      |
| Drizzle                          | SQL-transparent, lightweight                                                       | Prisma (heavier abstraction)                                   |
| Kafka ≥ 4.2 (KRaft)              | replayable log, offsets, partition ordering                                        | RabbitMQ (no replay), NATS (2nd broker)                        |
| `@confluentinc/kafka-javascript` | maintained, Confluent-supported, prebuilt binaries (Windows x64, Linux arm64)      | KafkaJS (no release since 2023)                                |
| BullMQ                           | delays/priorities/repeatable jobs                                                  | Kafka share groups (broker GA, Node client preview only)       |
| gRPC service-to-service          | typed contracts, deadlines, streaming-ready                                        | gRPC at the edge (translating gateway)                         |
| `ws` (raw)                       | full protocol control — we own reconnect/resume                                    | Socket.io (documented alternative if productivity wins)        |
| Better Auth (core only)          | users + sessions + OAuth, self-hosted, Drizzle adapter                             | org plugin (§3), Auth.js, Keycloak (external dep early)        |
| React Email                      | type-safe JSX→HTML templates; transport swappable via BullMQ jobs                  | hand-built HTML, SendGrid-only                                 |
| Vitest/Testcontainers/Playwright | unit/integration against real Postgres/Redis/Kafka; few critical-journey e2e       | mocks for owned infrastructure                                 |
| OpenTelemetry                    | traces across gateway → service → Kafka → socket; RED metrics; backend is config   | vendor SDKs in code                                            |

### Why these choices belong together (Decision Evolution)

> **Supersedes `initial-blueprint-draft.md`:** That draft explored a modular monolith on **NestJS + Next.js + Nx + ESLint/Prettier**. An intermediate pass considered **Express + Nx + Biome + one ESLint boundary rule**. Here is why the final stack converged cleanly on **Turborepo + Biome + Fastify v5 + TanStack Start**:

1. **Why Node.js/TypeScript without NestJS (and why Fastify v5 over Express):**
   - NestJS is _not_ a separate language—it is a TypeScript framework running on Node.js. Skipping NestJS was a deliberate choice to avoid heavy Angular-style decorators, reflection magic, and DI container indirection in favor of explicit, auditable services.
   - Express 5 was initially considered for familiarity, but **Fastify v5** eliminates microservice boilerplate: built-in **Pino** JSON logging (`trace_id` ready), native Zod validation/serialization (`fastify-type-provider-zod`), `@fastify/http-proxy` for `api-gateway`, official OpenTelemetry support via **`@fastify/otel`** (replacing deprecated `@opentelemetry/instrumentation-fastify`), and clean Better Auth integration via a standard Web `Request` bridge (`fromNodeHeaders` + `auth.handler`).
2. **Why Turborepo + pure Biome replaced Nx + ESLint/Prettier:**
   - **Nx** pairs natively with **ESLint + Prettier** (and shines with NestJS via `@nx/nest` generators). Its boundary enforcement (`@nx/enforce-module-boundaries`) requires ESLint. Keeping Nx alongside Biome would force maintaining two lint toolchains (Biome for formatting/linting + ESLint solely for one boundary rule).
   - Once NestJS was dropped, **Turborepo** became the cleanest orchestrator: its native **`turbo boundaries`** enforces tag-based package boundaries and blocks deep/undeclared imports directly in `turbo.json` (currently marked Experimental in Turborepo docs; `dependency-cruiser` is the documented fallback if needed). This lets **Biome** act as the single, unified Rust linter and formatter across the entire repo with **zero ESLint and zero Prettier**.
3. **Why TanStack Start over Next.js:**
   - Because Katha sits behind authentication, marketing SEO is irrelevant. TanStack Start (1.0 GA) gives full-document SSR when needed, end-to-end type-safe routing via TanStack Router, and a fast Vite dev loop without Next.js's server-component complexity.
4. **Why pnpm + catalog over Bun:**
   - `pnpm` strict symlink isolation prevents phantom imports, `pnpm-workspace.yaml` `catalog:` enforces a single dependency version across all 9 services, and Node.js + pnpm provide proven stability for native C++ bindings (`@confluentinc/kafka-javascript`).

**Testing invariants (must have tests):** gap-free `seq` under
concurrent sends · durability-before-ack · resume-after-disconnect
with zero loss · dedupe on retried sends · claims rejected when
forged/expired/wrong `aud` · authz fail-closed after TTL.

**Observability from the first service:** structured JSON logs with
`trace_id`, W3C trace context propagated through HTTP, gRPC, Kafka
headers and the WS ticket. Collector + backend arrive in Phase 5.

---

## 12. Decision reversal triggers

| #   | Decision                       | Merge/exit when                                                                                                                                                                              |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 9 services day-one             | real product → Strangler Fig path (boundaries already modular)                                                                                                                               |
| D2  | auth ≠ user                    | <15 endpoints AND no scaling/security-isolation need. Re-confirm at step 1.4                                                                                                                 |
| D3  | workspace ≠ message            | authz checks chatty despite cache OR denormalization unmanageable                                                                                                                            |
| D4  | realtime owns presence         | presence needs independent driver (analytics, cross-service API)                                                                                                                             |
| D5  | Kafka + BullMQ both            | BullMQ → Kafka share groups when the Node client's share consumer is GA + delay/repeat ergonomics proven                                                                                     |
| D6  | Mongo for notification inbox   | Decide at Phase 3 spec. Use Postgres JSONB instead if the 12 GB budget is tight or the inbox shows no document-shaped need                                                                   |
| D7  | gRPC service-to-service        | REST+zod if proto machinery becomes friction                                                                                                                                                 |
| D8  | TanStack Start                 | Vite+RR if instability; Next.js only for marketing surface. Pin react-start ≥1.168.60 / start-server-core ≥1.169.39 (CVE-2026-102989 XSS, patched Sep 2026); track advisories                |
| D9  | Turborepo + `turbo boundaries` | Nx + ESLint if experimental `turbo boundaries` lacks needed AST boundary rules; or `dependency-cruiser` as fallback                                                                          |
| D10 | Fastify v5                     | Express 5 if a specific middleware strictly requires Express — use `@fastify/otel` (not deprecated `@opentelemetry/instrumentation-fastify`) and native Web `Request` bridge for Better Auth |
| D11 | Object storage engine          | Chosen at Phase 4 against the S3 features media-service needs (presigned PUT, multipart). Code depends on the S3 API only                                                                    |
| D12 | Membership only in workspace   | Revisit the Better Auth org plugin only if it gains transaction-scoped hooks AND the duplication argument no longer holds                                                                    |

---

## 13. Open questions

E2E encryption demand (deferred, pluggable) · target concurrency
(drives phase order) · retention/legal policy · media abuse scanning
· authz staleness tolerance per op criticality.

---

## Sources

`docs/research/*` · `initial-blueprint-draft.md` · Rocket.Chat
microservices docs · Slack engineering (cached bitmask) · HLD
Handbook · System Design Atlas · Stream · Irurueta · Ably ·
Apache Kafka 4.2 release notes (KIP-932) · librdkafka changelog ·
BullMQ docs · TanStack Start advisory GHSA-qx66-fv34-fjm8 ·
Better Auth docs (CLI, database hooks, JWT plugin) and issues 10202
and 10829 · Oracle Always Free resources · MinIO repository
notice · Turborepo boundaries docs · Fastify v5 + `@fastify/otel` + Better Auth Fastify docs.
