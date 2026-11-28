# ADR-011: Testing Strategy for Distributed Systems

## Status

Question approved — answer drafted (under review)

## The Question

How should a microservices system be tested — which test levels
exist, what does each one actually verify, and how are the
unique challenges of distributed systems handled?

1. **The test pyramid in microservices.** What test levels exist —
   unit, integration, contract, end-to-end — and what does each
   layer catch that the others cannot? How does the pyramid shift
   when services are distributed?

2. **Contract testing.** How are API/proto/event contracts verified
   without standing up full environments — consumer-driven
   contracts, provider verification, schema registries? Why do
   contracts need dedicated testing in microservices?

3. **Integration & service testing.** How are service dependencies
   handled in tests — testcontainers, ephemeral environments,
   service virtualization/mocks? When is a mock legitimate versus
   a liability?

4. **E2E testing scope.** What can true end-to-end tests cover and
   what can they never cover — and where do they sit relative to
   failure-path and resilience testing?

5. **Test data & environments.** How is test data managed —
   shared vs. ephemeral, data seeding, environment sprawl — and
   how is flakiness controlled in distributed test suites?

---

## Answer

### 1. The test pyramid in microservices

The test pyramid (Fowler's bliki, 2012; Cohn's original metaphor)
is a statement about _economics_, not just coverage: many cheap,
fast, deterministic tests at the bottom; few expensive, slow,
brittle ones at the top. The layers, and what each uniquely
catches:

- **Unit tests** exercise a single function or class with all
  dependencies stubbed. They catch logic errors in milliseconds,
  are deterministic, and should constitute the bulk of the suite.
  Ham Vocke's "Practical Test Pyramid" (2018) is the standard
  modern treatment: unit tests are where branching logic,
  validation, and edge cases live.
- **Integration tests** wire a component to its real dependencies
  — a database, a cache, a file system. They catch the bugs unit
  tests structurally cannot: serialization mismatches, SQL
  errors, ORM mapping mistakes, transaction semantics. Google's
  "Software Engineering at Google" (ch. 11) treats the
  unit/integration distinction as the core axis.
- **Service/API tests** exercise one service's whole surface —
  its HTTP or message API against real internals — verifying
  end-to-end behavior _within_ a service boundary without
  involving other services.
- **Contract tests** verify that a service's interface matches
  what its consumers expect — see §2. In a microservices world
  this is a first-class layer, not an optional extra.
- **End-to-end tests** run the assembled system through real
  boundaries — network, serialization, deployment wiring. They
  catch emergent failures no lower layer can see, at the highest
  cost per test.

**How distribution shifts the pyramid.** The shape survives but
the middle band thickens: when services deploy independently,
the "does service A's API still work with service B" question
cannot be answered by unit tests, so _contract_ and
_service-level_ tests carry weight that used to live in a few
E2E tests. The top stays thin — Google's testing guidance argues
E2E should cover only critical user journeys, because each one
is slow, flaky, and expensive to diagnose. Fowler's formulation
is the right mental model: high-level tests are a _second line
of defense_ — when one fails, the bug should be replicated as a
lower-level test so it stays dead.

### 2. Contract testing — verifying interfaces without full environments

**Why contracts need dedicated testing.** In a monolith, a
compile error catches interface mismatches. In microservices,
services deploy independently on their own schedules — the only
thing binding them is the contract (HTTP API, gRPC proto, event
schema), and the only way to discover a mismatch in production
is an outage. Standing up the full environment per pull request
to check one interface is the cost contract testing avoids.

**Consumer-driven contracts (CDC).** Ian Robinson's 2006 article
(named the pattern) and Pact's implementation define the
mechanism: the _consumer_ writes tests describing the requests
it makes and the minimal responses it needs, run against a mock
provider. Pact's flow (per its docs) is:

1. Consumer test registers an interaction — expected request,
   minimal expected response — with a mock provider.
2. The test fires a real request; the mock verifies it matches
   and returns the canned response; the consumer verifies it
   handles the response correctly.
3. All interactions are recorded into a **pact file** — a
   "contract by example" containing only what consumers
   actually use, not the provider's full surface.
4. A **provider verification** job (in the provider's CI)
   fetches the pact, replays each request against the real
   implementation, and asserts the actual response contains at
   least the expected fields — catching provider changes that
   break consumers before they deploy.

The payoff: only _used_ behavior is pinned, so providers remain
free to change everything consumers don't touch. A pact broker
adds "can I deploy?" checks — has this consumer's contract been
verified against the provider version about to ship?

**Schema registries** solve the adjacent problem for
schema-evolving message/event pipelines: Confluent Schema
Registry stores Avro/Protobuf/JSON schemas and enforces
compatibility rules (backward/forward/full) at registration
time, so producers and consumers agree on wire format as schemas
evolve; `buf breaking` does the same class of check for protobuf
APIs in CI. The distinction worth holding: a schema verifies
_shape_; a consumer-driven contract verifies _usage_ — a
provider can satisfy a schema and still break a consumer that
relied on a specific field combination.

### 3. Integration & service testing — real dependencies, virtual services

**Testcontainers** is the dominant answer to "real dependency,
zero setup": it runs throwaway Docker containers — Postgres,
Kafka, Redis, browsers — that live and die with the test. The
mechanism matters: tests get a _known initial state_, the real
wire protocol and database engine (not a reimplementation), and
no shared mutable environment. This eliminates the two classic
integration-test failure modes — "works on my machine" version
drift and cross-test contamination — while keeping tests
self-contained and parallelizable.

**Ephemeral environments** extend the same idea upward: a
per-branch or per-PR deployment of the whole system for true
pre-merge verification. They trade infrastructure cost and
configuration drift risk for fidelity — worth it for release
candidates, too heavy for every commit.

**Service virtualization** (WireMock being the standard tool)
runs a stub server that emulates a dependency's API — canned
responses, request verification, and deliberately injected
faults (latency, 500s, malformed payloads). It is _legitimate_
when: the dependency is external and slow/flaky (third-party
payment APIs, email), when you need failure modes on demand for
resilience tests, or when a dependency simply does not exist
yet and you are building against its contract. It becomes a
_liability_ when the stub's behavior is hand-maintained and
drifts from the real service — the stub then tests your
_assumptions_ about the dependency, not the dependency. The
rule of thumb: mock at the boundary, and verify the boundary —
which is exactly what contract tests are for.

### 4. E2E testing scope — what it can and cannot cover

E2E tests occupy the top of the pyramid: they drive the
assembled system through real boundaries — actual network
serialization, real deployment wiring, real service discovery —
and assert that critical user journeys complete. What they
_cover_: the seams no lower layer sees (a proto field renamed
on both sides, a load balancer misconfiguration, a missing
environment variable), and they double as deployment smoke
tests.

What they _never_ cover: every dependency combination (the
state space is combinatorial), failure modes under load or at
scale, rare timing races, and anything about _how_ the system
fails — E2E asserts that things work; resilience is about
verifying they _degrade correctly_, which is a different test
question answered by chaos engineering and fault injection
(see ADR-009 §5).

The economics explain the thin top. Google's "Just Say No to
More End-to-End Tests" (2015) documents the failure mode: a
single failing E2E could implicate any of N services, so root
cause takes hours-to-days; suites run nightly rather than per
commit; flakes erode trust until real failures get ignored.
The Testing for Reliability chapter of the SRE book adds the
complementary view — tests that block a push before production
have zero MTTR, which is why the pyramid pushes verification
as early as possible. E2E earns its cost only on the critical
journeys where "the whole thing assembled" is itself the risk.

### 5. Test data & environments — determinism is the product

**Test data strategies**, roughly by preference: _ephemeral
known state_ — each test gets a fresh container/instance seeded
by factories or builders, so tests are independent and
order-free (the Testcontainers model); _seeded fixtures_ for
read-heavy scenarios; _anonymized production snapshots_ when
realistic data shapes matter — viable only with rigorous PII
scrubbing, and a known source of both realism and leakage
risk. Anti-patterns: shared mutable fixtures across tests
(order dependence = flakiness factory) and hand-crafted SQL
dumps that silently drift from the schema.

**Environment sprawl** is the distributed-systems version of
the problem: staging environments accumulate configuration that
no longer matches production, so "passes on staging" proves
little. The spectrum of answers: shared staging (cheap, but
contended and drift-prone), ephemeral per-PR environments
(fidelity, at real infrastructure cost), and "test in
production" for the residual risks only production exhibits —
behind flags, with blast-radius controls.

**Flakiness control** is where distributed suites live or die.
Google's data (Micco, 2016) is sobering: roughly 1.5% of all
test _runs_ report flaky results, ~16% of tests exhibit some
flakiness, and ~84% of pass→fail transitions involve a flaky
test — meaning most "new" failures are noise, which trains
engineers to ignore real ones. Causes cluster into: shared
state between tests, time dependence (real clocks, sleeps,
timeouts), non-determinism (unordered collections, concurrency),
network and infrastructure dependence, and retries masking
timing assumptions.

Controls, in order of value: eliminate the cause — deterministic
clocks, no real sleeps (wait on conditions, not durations),
full state isolation, health-check dependencies before the
suite starts; then contain the residue — rerun-only-failures,
quarantine policies that remove chronically flaky tests from
the critical path while tracking them as bugs, and per-test
flake-rate metrics so flakiness is measured rather than felt.
Retries and quarantines are mitigations, not cures — Google's
own experience is that the fix rate roughly equals the
insertion rate, so flakiness is a tax you budget for and
engineer against continuously, not a problem you solve once.

### Sources

- Fowler, ["Test Pyramid" (2012)](https://martinfowler.com/bliki/TestPyramid.html);
  Vocke, ["The Practical Test Pyramid" (2018)](https://martinfowler.com/articles/practical-test-pyramid.html);
  Winters et al., [_Software Engineering at Google_, ch. 11 "Testing Overview"](https://abseil.io/resources/swe-book/html/ch11.html)
- Google SRE Book — ["Testing for Reliability" (2016)](https://sre.google/sre-book/testing-reliability/);
  Wacker, ["Just Say No to More End-to-End Tests" (2015)](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html);
  Micco, ["Flaky Tests at Google and How We Mitigate Them" (2016)](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html)
- Robinson, ["Consumer-Driven Contracts: A Service Evolution Pattern" (2006)](https://martinfowler.com/articles/consumerDrivenContracts.html);
  [Pact — Introduction](https://docs.pact.io/);
  [Pact — How Pact works](https://docs.pact.io/getting_started/how_pact_works)
- [Testcontainers](https://testcontainers.com/);
  [WireMock](https://wiremock.org/);
  [Confluent — Schema Registry](https://docs.confluent.io/platform/current/schema-registry/index.html);
  [buf — Detecting breaking changes](https://buf.build/docs/breaking)
