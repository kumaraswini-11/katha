# ADR-004: Architectural Models & Patterns

## Status

Question approved — answer drafted (under review)

## The Question

Beyond choosing an architecture style (see ADR-003), which
structural models and patterns should shape how a system is built —
and which model is best suited for a given context?

1. **The model landscape.** Which architectural models and patterns
   exist — layered/n-tier, hexagonal (ports & adapters),
   clean/onion architecture, domain-driven design tactical
   patterns, event-driven architecture, space-based architecture,
   pipe-and-filter, CQRS, plugin/microkernel, and others? What
   problem does each one solve?

2. **What each model buys.** For each model: what complexity does
   it reduce, what does it cost, and what organizational or
   technical preconditions does it assume?

3. **Fitness criteria.** Which factors determine the best-suited
   model — domain complexity, team maturity, scale requirements,
   consistency needs, time-to-market pressure? When is a simpler
   model the right choice even when a more sophisticated one is
   available?

4. **Composability.** How do models combine in practice — e.g.,
   hexagonal inside a service, event-driven between services? Which
   combinations are proven and which create conflicting
   constraints?

---

## Answer

### 1. The model landscape

Architectural models operate at two different levels, and confusing
them is the most common source of bad advice: some govern the
_inside_ of a deployable unit (how one service/module is structured),
others govern the _between_ (how units integrate). Here is the
landscape, grouped accordingly.

**Structural models — inside a deployable unit:**

- **Layered / n-tier.** The oldest and simplest: split a system
  into horizontal layers — presentation, business logic, data
  access — where each layer may only call the layer below it.
  Microsoft's architecture guidance describes it as logical layers
  optionally mapped to physical tiers. It solves organization for
  CRUD-style applications: each layer has one responsibility and
  dependencies flow one direction. Its weakness is that "business
  logic" smeared across layers produces an anemic design where the
  data model drives everything — workable, but it caps how rich the
  domain model can get.
- **Hexagonal architecture (ports & adapters).** Alistair Cockburn's
  2005 pattern: the application core sits in the middle and talks
  to the outside world exclusively through _ports_ — interfaces
  defined by the inside, expressing what the application needs
  ("save an order," "send a notification") or provides ("handle a
  command"). _Adapters_ on each side implement those ports with
  concrete technology — an HTTP adapter, a Postgres adapter, a
  message-broker adapter, an in-memory test adapter. The mechanism
  that matters: dependencies point inward, so the core can be
  developed and unit-tested with zero infrastructure. Its stated
  purpose was pragmatic — run automated regression tests against
  the application without a UI or database, survive database
  replacement, and let programs drive the app headlessly.
- **Clean / Onion architecture.** Concentric-ring variants of the
  same idea. Robert Martin's "Clean Architecture" (2012) and
  Jeffrey Palermo's "Onion Architecture" (2008) both formalize the
  _dependency rule_: source-code dependencies may only point
  inward. Entities and use-case policies sit at the center;
  interface adapters, frameworks, databases, and UIs live in outer
  rings and may depend on inner ones — never the reverse. Onion
  adds a domain-model core with repository interfaces at the first
  ring; Clean adds explicit use-case and interface-adapter rings.
  Mechanically they solve the same problem as hexagonal — keep
  business rules free of framework and IO entanglement — with more
  explicit ceremony about _which_ ring a class belongs to.
- **DDD tactical patterns.** Not a layering scheme but a modeling
  vocabulary for the core itself: _entities_ with identity,
  _value objects_ defined by attributes, _aggregates_ that
  encapsulate invariants and are the unit of consistency,
  _repositories_ that abstract persistence, _domain services_ for
  logic that doesn't belong to one entity, and _domain events_ for
  things that happened. Evans' DDD reference describes these as the
  building blocks for expressing business rules explicitly in code
  rather than scattering them across procedural code. The problem
  they solve: business invariants ("an order can't ship before
  payment clears") become enforceable properties of the model
  instead of conventions everyone must remember.
- **Pipe-and-filter.** A data-processing model: break a task into
  small, stateless _filters_, each performing one transformation,
  connected by _pipes_ carrying data between them. Microsoft's
  pattern guidance notes the payoff: filters can be composed into
  new pipelines, updated or reordered independently, run on
  different hardware, and scaled in parallel — with throughput
  bounded by the slowest stage and backpressure handling overload.
  It solves sequential transformation pipelines (ETL, media
  transcoding, log processing) where stages are naturally
  independent.
- **Plugin / microkernel architecture.** A tiny stable core provides
  only the mechanisms every feature needs (lifecycle, extension
  points, shared services); all real functionality arrives as
  _plugins_ conforming to a published contract. Browsers,
  IDEs like VS Code/Eclipse, and Jenkins work this way. It solves
  extensibility: the product grows by adding plugins without
  modifying the core — but the plugin contract becomes the
  critical, hard-to-change interface of the whole system.

**Integration / data-flow models — between deployable units:**

- **Event-driven architecture (EDA).** Producers emit events to a
  broker or channel; consumers react. Microsoft's architecture
  guidance identifies the key property: producers and consumers are
  decoupled in time and space — a consumer doesn't need the
  producer running, and new consumers can join the stream. Two
  topologies matter: the _broker_ topology (publish-subscribe,
  fully decoupled, dynamic — but no central coordination of
  multi-step flows) and the _mediator_ topology (a central
  component sequences commands for multi-step business processes).
  It solves temporal coupling and bursty load, at the price of
  eventual consistency and harder end-to-end reasoning.
- **Space-based architecture.** Designed for extreme, spiky load
  where the database itself is the bottleneck: requests hit a
  load-balanced set of _processing units_, each holding its slice
  of data in memory (a replicated data grid), doing all reads and
  writes locally, and asynchronously write-behind to the database
  for durability. A message bus provides elasticity — units spin
  up and down with load. It trades consistency and operational
  simplicity for the ability to scale past what a central database
  can serve.
- **CQRS (Command Query Responsibility Segregation).** Splits the
  conceptual model into two: a _command_ model handling updates
  (validation, invariants, business logic) and a _query_ model
  optimized for reads (denormalized, possibly a different
  datastore). Fowler's canonical warning: it "adds risky
  complexity" for most systems and should be applied to
  _portions_ of a system, not the whole — the payoff is real when
  read and write loads are asymmetric or a domain is genuinely
  complex enough that one model can't serve both well.
- **Event sourcing** (adjacent to CQRS and often paired): persist
  state as an append-only sequence of events rather than current
  state; state is rebuilt by replay. Fowler's description: every
  change to application state is captured as an event, enabling
  complete rebuilds, temporal queries, and event replay. It
  delivers a perfect audit log but makes querying the current
  state expensive — which is why it almost always pairs with CQRS.

### 2. What each model buys

For each model: the complexity it reduces, what it costs, and the
preconditions it assumes.

- **Layered / n-tier.** _Buys:_ familiarity (most developers have
  seen it), clear separation of concerns, easy onboarding, cheap
  to apply to CRUD apps. _Costs:_ the "business logic" layer tends
  to become a pass-through; the anemic-domain trap where the data
  model drives design; rigid horizontal slicing that makes
  vertical features span all layers. _Assumes:_ moderate domain
  complexity, stable requirements, a team that doesn't need rich
  domain modeling.
- **Hexagonal.** _Buys:_ the core is testable without IO (an
  in-memory adapter replaces the database), infrastructure is
  swappable (swap the Postgres adapter for another datastore
  without touching the core), and the dependency direction is
  mechanically enforceable. _Costs:_ indirection and boilerplate —
  every external interaction needs a port and an adapter; mapping
  between domain objects and persistence records is still manual.
  _Assumes:_ a non-trivial core worth isolating; for trivial
  scripts the ceremony isn't justified.
- **Clean / Onion.** _Buys:_ the same inside-outside isolation
  with more explicit rules about where each class belongs —
  easier to review "which ring is this in?" than "is this a port
  or an adapter?" _Costs:_ more ceremony and more concepts
  (entities vs. use cases vs. interface adapters) for the same
  fundamental win. _Assumes:_ a rich domain and a team disciplined
  enough to respect ring boundaries — Palermo himself notes it's
  inappropriate for small websites.
- **DDD tactical.** _Buys:_ business rules live in the model where
  they can be enforced and tested; ubiquitous language aligns code
  with the business; aggregates give you explicit consistency
  boundaries. _Costs:_ significant upfront modeling effort —
  Evans' approach requires exploring the domain before coding;
  over-application to simple CRUD produces ceremony without
  benefit. _Assumes:_ genuine domain complexity — rules,
  invariants, lifecycle — worth modeling.
- **Pipe-and-filter.** _Buys:_ independent scaling and
  parallelism per stage; stages are stateless and reusable across
  pipelines; failures isolate to a stage. _Costs:_ every stage
  boundary adds latency and serialization overhead; ordering and
  backpressure must be designed, not assumed. _Assumes:_ a
  sequential transformation pipeline where stages genuinely don't
  need shared state.
- **Plugin / microkernel.** _Buys:_ the product extends without
  core changes — new features, customer-specific variants, and
  third-party add-ons arrive as plugins; a misbehaving plugin
  can be disabled without touching the core. _Costs:_ the plugin
  contract is a permanent, hard-to-evolve interface; versioning
  plugins against core releases is a known pain; the core team
  becomes a bottleneck for contract changes. _Assumes:_
  extensibility is a core business requirement (editors,
  platforms, rule engines) — not a nice-to-have.
- **EDA.** _Buys:_ temporal and spatial decoupling — producers
  don't wait for consumers, consumers don't need producers
  alive; natural fit for bursty, async-tolerant workflows;
  each consumer scales independently. _Costs:_ eventual
  consistency becomes the default; debugging a flow that crosses
  services requires distributed tracing; event schema
  versioning is a permanent discipline. _Assumes:_ the business
  tolerates asynchronous processing — it's wrong for operations
  that must complete synchronously with a definitive answer.
- **Space-based.** _Buys:_ linear-ish elasticity for spiky load;
  the database leaves the critical path of request handling.
  _Costs:_ high complexity — data grids, write-behind
  consistency, conflict resolution; data is only as durable as
  the async write path; operational weight is significant.
  _Assumes:_ extreme scale or volatility that a conventional
  database-backed architecture demonstrably can't serve.
- **CQRS.** _Buys:_ read and write workloads scale
  independently; the query model can be denormalized and
  optimized for exactly the queries it serves (often a different
  datastore); command-side invariants stay clean. _Costs:_ two
  models to maintain; the read side is eventually consistent —
  "read your own writes" needs explicit handling; Fowler's
  warning that most systems don't need it. _Assumes:_
  significant read/write asymmetry or a complex domain — apply
  to bounded portions, not the whole system.
- **Event sourcing.** _Buys:_ perfect audit trail, temporal
  queries ("what did we believe on date X?"), easy replay and
  debugging of state changes; the event log doubles as the
  integration mechanism for EDA. _Costs:_ current-state queries
  require replay or snapshots; storage grows unboundedly;
  unfamiliar programming model. _Assumes:_ auditability,
  temporal analysis, or replay are genuine requirements.

### 3. Fitness criteria

Which model fits is determined by the _problem's_ properties, not
the model's sophistication. The factors that actually decide:

- **Domain complexity.** Rich business rules, invariants, and
  lifecycle → DDD tactical patterns inside a ports-and-adapters
  or clean core. Simple CRUD with thin logic → layered
  architecture or transaction scripts; the domain model would be
  ceremony.
- **Team maturity and size.** Hexagonal, clean, and DDD demand
  discipline — dependency rules that must be actively enforced,
  modeling skills, and the patience to keep the core clean. A
  smaller or less experienced team often ships faster with a
  pragmatic layered design and ports-and-adapters only where IO
  actually needs isolating.
- **Scale requirements.** Ordinary scale → monolith-friendly
  models suffice. Extreme, spiky load where the database
  bottlenecks → space-based. High-volume async flows → EDA.
- **Consistency needs.** Operations that must be strongly
  consistent and synchronous → keep them in one transactional
  boundary (monolith or a single service with its own database).
  Asymmetric read/write or cross-service queries → CQRS.
- **Time-to-market pressure.** Every architectural model is a
  tax paid forever — indirection, mapping code, conceptual
  overhead. Under delivery pressure, the simplest model that
  meets _current, evidenced_ constraints wins; you can refactor
  toward richer models when the pain is real.
- **Change profile.** If requirements are stable and the domain
  is understood → simpler models. If the domain is still being
  discovered → models that keep the core isolated (hexagonal)
  pay off because the IO edges are the parts most likely to
  change.

**When is a simpler model right even when a sophisticated one is
available?** Precisely when the sophisticated model's preconditions
aren't met: no genuine domain complexity (skip DDD), no read/write
asymmetry worth paying for (skip CQRS), no proven scale problem
(skip space-based), no extensibility requirement (skip plugin), no
async-tolerant workflows (skip EDA). Fowler's CQRS essay generalizes
to all of them: _most_ systems fit the simpler model, and the
sophisticated one "adds risky complexity." A pattern is a solution
to a recurring problem — applying it where the problem doesn't
exist is pure cost.

### 4. Composability

Models compose at different levels, and the proven combinations
respect that separation:

**Proven combinations:**

- **Hexagonal / clean inside each service, EDA between
  services.** This is the standard microservice anatomy: each
  service's core is isolated behind ports and adapters (its own
  HTTP/gRPC adapter in, its own database adapter out), while
  services integrate asynchronously through events on a broker.
  Cosmic Python demonstrates this composition concretely —
  domain model at the center, repository and message-bus
  adapters at the edges, events integrating services.
- **DDD tactical inside the hexagonal/clean core.** The
  innermost ring is where aggregates, entities, and value
  objects live — the models aren't competitors, they're
  layers of the same onion.
- **CQRS for read-heavy bounded contexts.** Apply CQRS inside a
  service (or bounded context) whose query load dwarfs its write
  load — a dashboard service, a feed service — while the rest of
  the system stays on a shared model. Fowler explicitly
  recommends scoping it to portions of a system.
- **Event sourcing + CQRS + EDA** for audit-heavy or
  temporally-queried domains: events are the write model,
  projections are the read model, and the same events feed
  other services.
- **Pipe-and-filter inside services** that process streams —
  the filter stages are an internal structure choice, invisible
  to the services around them.
- **Plugin inside products** that need extensibility — the
  microkernel is an application-level choice that sits beneath
  whatever internal model the core uses.

**Combinations that create conflicting constraints:**

- **CQRS + synchronous read-your-writes expectations.** If the
  UI must immediately reflect a user's own change, an
  eventually-consistent query model breaks the contract — you
  must design around it (return the write result directly,
  poll, or accept a "processing" state).
- **EDA + strong-consistency requirements.** Event-driven
  integration is eventually consistent by nature; workflows
  that genuinely need atomic multi-service state changes
  require sagas with compensations — a heavier, more complex
  mechanism that should be the exception, not the default.
- **Space-based + relational reporting needs.** Data grids
  optimize for in-memory access patterns; complex ad-hoc
  analytical queries against the same data fight the model.
- **Plugin architecture + strict team ownership.** Plugin
  contracts are owned by the core team; if feature teams must
  ship independently, the contract becomes a bottleneck —
  the model assumes a platform team serving plugin authors.
- **Pipe-and-filter + interactive low-latency requests.** A
  pipeline of stages adds latency at every hop; it's for
  throughput-oriented batch/stream work, not request-response
  APIs.
- **Stacking patterns that solve the same problem.** Hexagonal
  and clean/onion are _variants_ of the same inside-outside
  rule — pick one per module, don't blend them into an
  inconsistent hybrid.

**The composability rule:** models compose cleanly across
_levels_ (structure inside a service, integration between
services, data flow through pipelines) and conflict when they
compete for the _same_ concern. Before combining two models,
check that each one's preconditions from §2 still hold and that
their consistency assumptions don't contradict — an event-driven
integration layer wrapped around a CQRS read model that feeds a
synchronous UI is three eventual-consistency boundaries deep,
and the UX will feel it.

### Sources

- Cockburn, ["Hexagonal Architecture" (2005)](https://alistair.cockburn.us/hexagonal-architecture/);
  Martin, ["The Clean Architecture" (2012)](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html);
  Palermo, ["The Onion Architecture: part 1" (2008)](https://jeffreypalermo.com/blog/the-onion-architecture-part-1/)
- Evans, [DDD Reference (2015)](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf);
  Percival & Gregory, [Cosmic Python — ch. 1](https://www.cosmicpython.com/book/chapter_01_domain_model.html)
- Fowler, ["CQRS" (2011)](https://martinfowler.com/bliki/CQRS.html);
  ["Event Sourcing" (2005)](https://martinfowler.com/eaaDev/EventSourcing.html);
  ["Plugin" (PoEAA catalog)](https://martinfowler.com/eaaCatalog/plugin.html);
  ["Microservices" (2014)](https://martinfowler.com/articles/microservices.html)
- Richardson, ["CQRS" pattern (microservices.io)](https://microservices.io/patterns/data/cqrs.html)
- Microsoft Learn — [N-tier architecture style](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/n-tier);
  [Event-driven architecture style](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven);
  [Pipes and Filters pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/pipes-and-filters);
  [Architecture Styles overview](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/)
- Richards & Ford, [_Software Architecture Patterns_ (2017)](https://www.oreilly.com/library/view/software-architecture-patterns/9781491971437/) — space-based and microkernel/plugin architectures
