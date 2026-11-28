# ADR-003: System Architecture — Style & Service Decomposition

## Status

Question approved — answer drafted (under review)

## The Question

What architectural style should a system take — monolith, modular
monolith, microservices, serverless — and if microservices, how
should it be divided into services?

### Which architecture style

1. **Style selection.** When is a monolith the right architecture,
   and when do the forcing functions justify microservices? Where
   does the modular monolith fit — a legitimate end-state or a
   transitional step? What about serverless/FaaS as a style? Which
   signals indicate it is time to extract services, and which
   indicate microservices were the wrong choice?

### How to divide services

1. **Decomposition criteria.** Given microservices, what legitimately
   justifies a service boundary — independent scaling profile,
   distinct consistency/durability requirements, failure isolation,
   independent release cadence, team ownership, security boundaries,
   technology heterogeneity? And which factors do _not_ justify a
   split — user count, endpoint count, the desire to "use
   microservices"?

2. **Decomposition failure modes.** What does getting the division
   wrong look like — the distributed monolith, nanoservices,
   shared-database coupling — and how are they recognized and
   avoided?

---

## Answer

### 1. Which architecture style

Four styles are usually on the table. They differ in one fundamental
way: **where the boundary between "a unit of change" and "a unit of
deployment" sits** — inside one process, or across a network.

**Monolith.** A single deployable unit: one process (or a small set
of identical replicas behind a load balancer), in-process function
calls between components, typically one database. Its defining
properties are cheap coordination and free consistency — a business
transaction is a `BEGIN`/`COMMIT` in one database, a "call" to
another component is a function call with microsecond latency and no
network failure modes. Its costs are coupled change (every deploy
ships everything) and coupled scaling (you scale the whole app even
when only one part is hot). For most systems this is simply the
correct answer — Fowler and Lewis note that many applications build
successfully this way, and Fowler's "Microservice Premium" essay
(2015) states the guideline bluntly: _don't even consider
microservices unless you have a system that's too complex to manage
as a monolith_.

**Modular monolith.** The same single deployable, but with
_enforced_ internal module boundaries — modules own their tables or
schemas, dependency rules are checked by the build (import
restrictions, lint rules, package boundaries), and cross-module
communication goes through defined interfaces rather than reaching
into each other's internals. It is a legitimate end-state, not just
a waypoint: Shopify publicly describes its "deconstructed
monolith" as a deliberate architecture, 37signals has argued for the
"majestic monolith" for over a decade, and recent literature treats
it as the pragmatic default between a tangled monolith and
distributed services. The mechanism that makes it work is the same
as microservices — bounded contexts with owned data — minus the
network. Its weakness is enforcement: module boundaries in one
codebase decay unless the build actively prevents violations.

**Microservices.** A suite of independently deployable services,
each in its own process (or container/pod), each owning its
datastore, communicating over the network via APIs or messages.
What you gain: independent deploy/scale/fail per service, technology
heterogeneity, and team autonomy aligned to business capabilities
(Fowler & Lewis, 2014). What you pay — Fowler's "premium": automated
deployment pipelines per service, distributed tracing and
monitoring, handling partial failure and retries, eventual
consistency where there used to be transactions, and contract
versioning. Every one of those is real operational work, not a
detail. Microservices are justified when the _complexity of the
system_ — sheer size, multiple teams, multi-tenancy, independent
evolution of business functions, extreme scaling — exceeds what a
well-modularized monolith can handle.

**Serverless / FaaS.** Strictly speaking this is not a
_decomposition_ style but an _execution and deployment_ model:
ephemeral functions invoked by events or requests, billed per
invocation and per millisecond of execution, scaling from zero to
thousands of concurrent executions automatically. Its real
constraints: execution time limits (AWS Lambda caps at 15 minutes),
cold-start latency on infrequently used functions, all state
externalized (you cannot keep anything in process memory), and
tight coupling to a vendor's event/source model. It composes with
the other styles — a serverless function can _be_ a microservice —
but it doesn't answer "how do I divide my system"; it answers "who
runs my code and when."

**Forcing functions that justify extraction.** Look for _demonstrated
pain_, not anticipated pain: a module with a genuinely different
scaling profile (bursty batch work next to latency-sensitive API
traffic); a team whose release train is repeatedly blocked by
another team's changes; a blast-radius incident proving that one
component's failure shouldn't take down unrelated features; data
that two modules fight over with conflicting consistency needs; or
a workload that genuinely needs a different technology (a GPU
pipeline, a licensed runtime).

**Signals that microservices were the wrong choice.** Most
inter-service calls are synchronous and chatty — the network call
graph recreates the old in-process call graph with added latency
(each hop adds milliseconds, and five 20 ms hops add 100 ms to every
request); deploys still require lockstep ordering across services;
the operations team cannot keep N services healthy; and few services
actually scale or fail independently. That last symptom — services
that must change and deploy together — is the distributed monolith,
covered in §3.

The dominant evidence-based practice remains **monolith-first**:
build a well-modularized monolith, and extract a service when a
module demonstrably hurts — Shopify, Prime Video (which moved a
monitoring workload _back_ into a single process and cut cost ~90%),
and Segment (which consolidated ~140 services into a monolith) all
document both directions of this journey.

### 2. Decomposition criteria

A service boundary is expensive: it converts function calls into
network calls, local transactions into sagas, joins into API calls
or replicated read models, and one deploy pipeline into N. So the
bar for drawing one should be high. These factors _legitimately_
justify a boundary:

- **Independent scaling profile.** The classic case: one capability
  has bursty or CPU-heavy load while the rest is steady CRUD.
  Scaling the whole monolith to serve the burst wastes resources.
- **Distinct consistency/durability requirements.** A payments
  ledger that needs strict serializability and audit trails has
  different data needs than a recommendations engine that tolerates
  staleness. Forcing both into one consistency regime is a design
  smell.
- **Failure isolation.** If service A crashing should not take down
  service B's core function, they need separate failure domains —
  which means separate processes and, usually, separate data.
- **Independent release cadence and team ownership.** Conway's law
  cuts both ways: if two capabilities are owned by different teams
  shipping on different schedules, a shared deployable creates
  coordination tax. Team boundaries are a legitimate decomposition
  driver — but only when the _code_ boundaries already exist.
- **Security/compliance boundary.** Isolating PII-handling or
  PCI-scoped logic into its own service shrinks the attack surface
  and audit scope of everything else.
- **Genuine technology heterogeneity.** A workload that needs a
  different runtime, a GPU, or a licensed engine can justify its
  own service — though this is the rarest valid reason.
- **Data volume and lifecycle differences.** Hot transactional data
  and cold analytical/archive data have different storage,
  retention, and scaling needs.

What does **not** justify a split:

- **User count or request volume alone.** A monolith scales
  horizontally by running more replicas — QPS is not a boundary
  argument until a _specific_ component saturates a specific
  resource.
- **Endpoint or resource count.** "We have 60 REST endpoints" is a
  CRUD inventory, not a decomposition. Endpoints are cheap; service
  boundaries are not.
- **The desire to use microservices.** ThoughtWorks' Technology
  Radar explicitly warns about "microservice envy" — adopting the
  style because it is fashionable, which trades development
  simplicity for operational complexity without a forcing function.
- **Splitting along technical layers** (a "frontend service," an
  "API service," a "data service") or along CRUD verbs. Layers are
  _inside_ a service; verbs are operations on the same capability.
- **Splitting a consistency boundary.** If one user action — say,
  placing an order — inherently requires updating inventory,
  payment, and fulfillment state atomically, splitting those into
  separate services doesn't remove the atomicity requirement; it
  converts a database transaction into a saga with compensations.
  You haven't simplified the problem, you've relocated it to the
  hardest possible layer. Boundaries should follow natural
  transaction clusters — the set of state changes that must succeed
  or fail _together_ belongs behind one boundary.

### 3. Decomposition failure modes

**The distributed monolith.** Services split across a network that
retain the coupling of a monolith: they must deploy in lockstep,
they call each other synchronously in chains as deep as the old
in-process call graph, and often share a database. You get every
cost of distribution (latency, partial failure, contract
versioning) with none of the benefits (independent deploy, scale,
failure isolation). It is recognized by its symptoms: a single
feature requires coordinated changes and deploys across three or
more services; one service being down takes the whole feature
down; "chatty" inter-service calls add up latency budgets that were
never designed for; and the shared database means schema changes
are secretly distributed changes. Avoid it by drawing boundaries at
aggregate roots and business capabilities, preferring
asynchronous/event-driven integration where consistency allows, and
measuring coupling — if most features touch most services, the
boundaries are wrong.

**Nanoservices.** The opposite failure: services cut so small they
are smaller than a useful unit of work — one endpoint, one table, a
thin wrapper around a single query. Each service still pays the
full fixed cost Fowler calls the microservice premium: its own CI
pipeline, monitoring, alerting, on-call surface, and contract to
maintain. A service whose logic could live in a function inside
another service, and which cannot fail independently without
user-visible harm, is probably too small. A useful rule: a service
should own a meaningful business capability — something that could
be described to a product owner as a feature — and should be
independently useful or independently deployable. If you can't
articulate what breaks for a user when that service is down, the
boundary isn't earning its keep.

**Shared-database coupling.** Two or more services reading and
writing the same tables. The database becomes the real integration
point — a hidden contract that bypasses every API and event. The
symptoms: services issue `JOIN`s across what should be service
boundaries; a schema migration in one service breaks consumers it
didn't know existed; "transactions" span services anyway via shared
tables, defeating the entire point of the split. The fix is
database-per-service: each service owns its schema, exposes data
only through its API, and shares data across boundaries via events
and purpose-built read models — never via shared tables. Where a
monolith or modular monolith is concerned, modules may share a
database _server_ but should still respect schema-per-module
boundaries, with the database's own access controls (per-service
users and grants) enforcing the encapsulation that code review
alone won't guarantee.

**The shared-kernel trap** (worth naming alongside the above): a
"shared library" of domain logic that every service depends on.
Versioned and deployed independently it becomes a de facto monolith
inside the services — a change to the kernel forces coordinated
releases everywhere, recreating the coupling the services were
meant to escape. Share contracts (DTOs, schemas, types) freely;
share _behavior_ cautiously, and prefer duplication of small logic
over coupling of large logic.

The meta-rule across all three: **a service boundary should be
drawn where nature already drew one** — around a business
capability with its own data, its own consistency rules, and its
own reason to change. Everywhere else, the boundary is costing you
network hops, distributed transactions, and operational overhead to
solve a problem you didn't have.

### Sources

- Conway, ["How Do Committees Invent?" (1968)](http://www.melconway.com/Home/pdf/committees.pdf);
  Fowler & Lewis, ["Microservices" (2014)](https://martinfowler.com/articles/microservices.html);
  Fowler, ["Microservice Premium" (2015)](https://martinfowler.com/bliki/MicroservicePremium.html)
- Newman, [_Monolith to Microservices_ (2019)](https://samnewman.io/books/monolith-to-microservices/);
  Fowler, ["MonolithFirst" (2015)](https://martinfowler.com/bliki/MonolithFirst.html);
  DHH, ["The Majestic Monolith" (2016)](https://signalvnoise.com/svn3/the-majestic-monolith/)
- [Shopify, "Deconstructing the Monolith" (2019)](https://shopify.engineering/deconstructing-monolith-designing-software-maximizes-developer-productivity);
  [Prime Video, cost-reduction post (2023)](https://www.primevideotech.com/video-streaming/scaling-up-the-prime-video-audio-video-monitoring-service-and-reducing-costs-by-90);
  [Segment/Twilio, "Goodbye Microservices" (2018)](https://www.twilio.com/en-us/blog/developers/best-practices/goodbye-microservices)
- Richardson, ["Distributed monolith" explainer (Manning liveBook)](https://livebook.manning.com/learn/concepts/distributed-monolith--pattern/microservices-patterns-second-edition);
  ["Modular monolith" explainer (Manning liveBook)](https://livebook.manning.com/learn/concepts/modular-monolith--pattern)
- [ThoughtWorks Technology Radar — Microservice envy](https://www.thoughtworks.com/radar/techniques/microservice-envy)
- [AWS Well-Architected — Serverless Applications Lens](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/welcome.html);
  [AWS Builders' Library — "Timeouts, retries, and backoff with jitter" (2019)](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)
