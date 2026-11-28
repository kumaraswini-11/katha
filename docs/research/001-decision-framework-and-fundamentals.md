# ADR-001: Architecture Decision Framework & Fundamentals

## Status

Question approved — answer drafted (under review)

## The Question

Before any specific technology or pattern can be chosen, an engineer
needs a way to _think_ about architecture — the mental models behind
good decisions, a repeatable method for making them, and the core
concepts that everything else builds on.

### How to think & decide

1. **Mental models.** What philosophies underlie sound architecture
   decisions — domain-driven design and bounded contexts, Conway's
   law and team ownership, data ownership as the forcing function,
   monolith-first extraction? What do successful systems actually
   practice?

2. **A universal decision method.** Is there a repeatable method
   that applies to _any_ architecture or technology choice —
   survey the landscape, define criteria, weigh trade-offs, test
   fitness against context, weigh reversal cost?

3. **Decision interplay & reversibility.** How do architecture
   decisions constrain each other — which must come first, which
   can change later, and what does reversing each one cost?

### Core concepts — concurrency & async

1. **What "asynchronous" actually means.** In JavaScript, async
   functions and callbacks are everyday tools — is the
   "asynchronous" used in message brokers and microservices the
   same concept or a different one? How do non-blocking I/O,
   callbacks/promises, and message-based decoupling relate?

2. **Parallel vs. concurrent.** Are parallelism and concurrency the
   same thing or different concepts? What exactly distinguishes
   them — simultaneous execution versus interleaved progress?

3. **Language variance.** Do synchronous/asynchronous and
   parallel/concurrent mean the same thing in every language, or do
   the concepts shift per language and runtime — threads, event
   loops, coroutines, actors? What is universal versus
   implementation-specific?

---

## Answer

### 1. Mental models — how sound architecture actually gets decided

Three philosophies show up repeatedly in systems that scaled well:

**Bounded contexts (DDD).** Eric Evans' _Domain-Driven Design_ (2003)
argues that a model only makes sense inside a boundary where its
language is consistent. Applied to services: a service boundary
should align with a business capability whose vocabulary, rules, and
lifecycle are coherent. Two capabilities that always change together
and share the same transactions probably belong in one service; two
that evolve independently probably don't. The classic failure mode
is splitting by technical layer — a "data service," an "API
service" — instead of by capability.

**Conway's Law.** Melvin Conway observed in 1968 that systems end up
mirroring the communication structure of the organizations that
build them. Practically: if two "services" always require the same
people in the same meetings to change, they are one service wearing
two hats. This is why _Team Topologies_ (Skelton & Pais, 2019) and
Amazon's two-pizza-team model treat team ownership as a first-class
design input rather than an afterthought.

**Data ownership as the forcing function.** A service boundary is
only real when the service owns its datastore and its consistency
boundary. If two services share a database or must run distributed
transactions to complete one user action, the boundary is
decorative — you have built a distributed monolith. This is why
"database-per-service" is the standard litmus test.

**Monolith-first is the dominant evidence-based practice.** Martin
Fowler's "MonolithFirst" essay (2015) and Sam Newman's _Monolith to
Microservices_ (2019) argue that the microservices tax — network
hops, distributed debugging, contract versioning, operational
overhead — should only be paid when a concrete pain (a scaling
hotspot, a deploy conflict, a blast-radius incident) proves a module
boundary needs to become a network boundary. The public record
supports this: Shopify documented its evolution from monolith to
modular monolith in 2019 ("Deconstructing the Monolith"), Prime
Video moved a monitoring workload from serverless microservices
back into a single process and cut cost by roughly 90% (2023),
Segment consolidated roughly 140 per-destination services back into
a monolith and cut deploy times from hours to minutes (2018), and
Basecamp/37signals has publicly argued for the "majestic monolith"
— a deliberately modular monolith — for over a decade.

The synthesis most mature teams land on: **draw boundaries along
business capabilities, own your data, expect your org chart to leak
into the design, and extract services when a module hurts — not
before.**

### 2. A universal decision method

The same method works for every architecture question — language,
broker, protocol, database:

1. **Frame the decision.** What problem are you actually solving?
   Write down the constraints that cannot change (compliance,
   existing systems, team skills, budget) _before_ evaluating
   options.
2. **Survey the real landscape.** List the genuine options —
   including "do nothing / keep the status quo" and "a module in a
   monolith" — not just the two you already happen to be comparing.
3. **Define criteria before evaluating.** Weighted requirements:
   performance, cost, team familiarity, operational weight,
   ecosystem maturity, reversibility. Criteria invented after seeing
   options are rationalization, not analysis.
4. **Weigh trade-offs honestly.** For each option: what it buys,
   what it costs, what it assumes. "Best" is meaningless without
   context — the real question is "best fit for _these_ constraints."
5. **Test fitness against your context.** A choice that is optimal
   for a 200-person platform team is often wrong for a 5-person
   product team. Match the option to _your_ scale, skills, and
   timeline.
6. **Prefer the cheapest reversible step.** When two options are
   close, pick the one that keeps future options open — you can
   always extract a service later; you cannot un-share a database
   cheaply.
7. **Record and date the decision.** Architecture Decision Records
   (Nygard, 2011) exist because undocumented decisions get
   relitigated. Write down what you chose, why, and what would make
   you revisit it.

This is essentially: requirements → options → trade-offs →
context-fit → reversibility → documentation. Neal Ford's
"fitness functions" (_Building Evolutionary Architectures_, 2017)
add the idea that some criteria can be encoded as automated checks
so the architecture does not silently drift.

### 3. Decision interplay & reversibility

Not all decisions are equal. Bezos's 1997 shareholder letter
popularized the distinction: some decisions are **one-way doors**
(hard to reverse) and some are **two-way doors** (cheap to walk
back through).

In practice:

- **Expensive to reverse:** data models and storage engines,
  public API contracts and wire protocols, language-per-service
  (medium cost), and team boundaries — Conway's law cuts both ways,
  and organizational change is the hardest reversal of all.
- **Cheap to reverse:** libraries and frameworks inside a service,
  internal refactors, CI tooling, most infrastructure choices when
  ports-and-adapters keep the core clean.

Two consequences follow:

- **Order matters.** Decide constraints first (what cannot
  change), then architecture style, then decomposition, then
  technology choices. Picking a message broker before deciding you
  need asynchronous messaging is putting the cart before the horse.
- **Match analysis effort to reversal cost.** For two-way doors,
  decide fast and learn by doing — a spike or prototype beats a
  week of slideware. For one-way doors, invest in the analysis,
  prototype the risky part, and write the ADR.

The meta-rule: **default to the simplest thing that meets current,
evidenced constraints — and design for change only where the cost
of being wrong is proven to exceed the cost of flexibility.**

### 4. What "asynchronous" actually means

The word covers three related but distinct ideas — conflating them
causes most of the confusion:

**(a) Non-blocking I/O — JavaScript's `async`.** Node.js is
single-threaded with an event loop: `async`/`await`, callbacks, and
promises let you _initiate_ an I/O operation and keep doing other
work instead of blocking the thread until it finishes. Here "async"
means "do not sit idle waiting" — a concurrency mechanism _inside_
one process.

**(b) Concurrent execution models.** `CompletableFuture` in Java,
`asyncio` in Python, goroutines in Go — the same idea: structure
work so that waiting does not serialize everything. Still
intra-process.

**(c) Temporal decoupling — message brokers.** When a producer
publishes an event to a broker and a consumer processes it minutes
later — possibly on a different machine — producer and consumer
never need to exist at the same time. The broker's "async" means
_decoupling in time and space_: the sender does not wait for the
receiver, and the receiver does not need the sender to be alive.

The relationship: (a) and (b) solve "don't block while waiting"
_within_ a process; (c) solves "don't require the other party to be
available right now" _between_ services. A Node.js service can use
`async`/`await` internally _and_ publish to a broker — the two
meanings coexist at different levels. When someone says "make it
async," always ask: async _what_ — non-blocking I/O, or decoupled
messaging?

### 5. Parallel vs. concurrent

These are different concepts; the distinction is _structure vs.
execution_:

- **Concurrency** is about _dealing with_ many things at once —
  structuring a program so multiple tasks can be in progress and
  interleave their execution. Concurrent tasks may or may not run
  simultaneously; on a single core they interleave via context
  switching.
- **Parallelism** is about _doing_ many things at once — actually
  executing tasks simultaneously on multiple processors or cores.

The canonical formulation (Rob Pike, "Concurrency is not
parallelism," 2012): **concurrency is about structure; parallelism
is about execution.**

Concrete example: one chef juggling three dishes — chopping,
stirring, monitoring the oven, switching between them — is being
_concurrent_ (many things in progress, interleaved). Three chefs
each working a different dish simultaneously are _parallel_. You
can have concurrency without parallelism (one core, many interleaved
tasks) and parallelism with little concurrency (two independent
CPU-bound jobs on two cores, each internally sequential).

Practical consequence: concurrency buys responsiveness and efficient
waiting — ideal for I/O-bound work. Parallelism buys raw throughput
for CPU-bound work, and only up to the number of physical cores.

### 6. Language variance — universal concepts, different mechanisms

The _concepts_ are universal — they describe properties of
computation itself, so synchronous/asynchronous and
parallel/concurrent mean the same thing in every language. What
varies is the _mechanism_ each runtime provides:

| Mechanism                      | Languages / runtimes                                       | Character                                                                 |
| ------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| Native OS threads (1:1)        | Classic Java, C#, early runtimes                           | Heavyweight; OS-scheduled; count limited to thousands                     |
| Green threads / M:N scheduling | Go goroutines, Kotlin coroutines, Java 21+ virtual threads | Lightweight; millions possible; runtime multiplexes onto fewer OS threads |
| Event loop (single thread)     | Node.js, browsers, Python `asyncio`                        | One thread, non-blocking I/O; CPU-bound work must leave the loop          |
| Actor model                    | Erlang/Elixir, Akka                                        | Massive concurrency via isolated actors + message passing; "let it crash" |
| Processes                      | Python `multiprocessing`, OS-level                         | True parallelism at heavy isolation cost                                  |

Two caveats worth knowing:

- **I/O-bound vs. CPU-bound changes everything.** For I/O-bound
  work (network, disk), most languages offer cheap concurrency — a
  single Node.js thread can hold thousands of connections. For
  CPU-bound work you need real parallelism across cores — and in
  Python specifically, the GIL means threads do not deliver parallel
  CPU execution; you need processes or native extensions.
- **The vocabulary shifts slightly.** "Async" in JavaScript
  specifically means promise-based non-blocking style; in Rust it
  often means `async`/`.await` state machines; in Go there is no
  `async` keyword at all — goroutines and channels are simply _how_
  concurrency works. Same concepts, different dialects.

**Takeaway:** architecture decisions should follow a repeatable
method — frame constraints, survey real options, define criteria
first, test fitness against _your_ context, prefer reversible steps,
and write it down. And the vocabulary of concurrency, while
universal in concept, is dialectal in practice — always specify
_which_ async and _which_ mechanism when a decision depends on it.

### Sources

- Conway, ["How Do Committees Invent?" (1968)](http://www.melconway.com/Home/pdf/committees.pdf);
  Evans, [_Domain-Driven Design_ (2003)](https://www.domainlanguage.com/ddd/);
  Skelton & Pais, [_Team Topologies_ (2019)](https://teamtopologies.com/)
- Fowler, ["MonolithFirst" (2015)](https://martinfowler.com/bliki/MonolithFirst.html);
  Newman, [_Monolith to Microservices_ (2019)](https://samnewman.io/books/monolith-to-microservices/)
- [Shopify, "Deconstructing the Monolith" (2019)](https://shopify.engineering/deconstructing-monolith-designing-software-maximizes-developer-productivity);
  [Prime Video, cost-reduction post (2023)](https://www.primevideotech.com/video-streaming/scaling-up-the-prime-video-audio-video-monitoring-service-and-reducing-costs-by-90);
  [Segment/Twilio, "Goodbye Microservices" (2018)](https://www.twilio.com/en-us/blog/developers/best-practices/goodbye-microservices);
  DHH, ["The Majestic Monolith" (2016)](https://signalvnoise.com/svn3/the-majestic-monolith/)
- Nygard, ["Documenting Architecture Decisions" (2011)](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions);
  Bezos, [1997 Amazon shareholder letter](https://www.aboutamazon.com/news/company-news/amazons-original-1997-letter-to-shareholders);
  Ford et al., [_Building Evolutionary Architectures_ (2017)](https://www.oreilly.com/library/view/building-evolutionary-architectures/9781491986356/)
- Pike, ["Concurrency is not parallelism" (2012)](https://go.dev/blog/waza-talk);
  [Go — Effective Go, concurrency](https://go.dev/doc/effective_go#concurrency);
  [Java JEP 444 — Virtual Threads](https://openjdk.org/jeps/444);
  [Python glossary — GIL](https://docs.python.org/3/glossary.html#term-global-interpreter-lock)
