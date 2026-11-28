# ADR-009: Resilience & Fault Tolerance

## Status

Question approved — answer drafted (under review)

## The Question

How should a microservices system be designed to survive partial
failure — which resilience patterns exist, what does each one
protect against, and when is each the right choice?

1. **The pattern landscape.** Which resilience patterns exist —
   timeouts, retries with backoff and jitter, circuit breakers,
   bulkheads, rate limiting, load shedding, hedged requests,
   failover — and what specific failure does each one guard
   against?

2. **Retry semantics.** Which operations are safe to retry — what
   makes an operation idempotent? How are retry storms and
   thundering herds prevented — budgets, jitter, caps?

3. **Failure isolation.** What distinguishes circuit breakers,
   bulkheads, and rate limiters — and when does each apply?
   How do they compose?

4. **Graceful degradation.** What does defined fallback behavior
   look like when a dependency is down — stale data, reduced
   functionality, queued work? How do health checks, readiness,
   and liveness probes fit in?

5. **Verifying resilience.** How is fault tolerance tested rather
   than assumed — chaos engineering, fault injection, game days,
   failure-path tests?

---

## Answer

### 1. The pattern landscape — what each pattern actually guards

Every resilience pattern is a bet that the system will face partial,
temporary failures, plus a specific mechanism for containing their
blast radius. Nygard's _Release It!_ (2nd ed., 2018) is the canonical
catalog of failure modes and patterns, and modern libraries such as
Polly organize the same vocabulary into composable strategies.
What each pattern does, and what it protects against:

- **Timeouts** bound how long a caller waits — a _connection
  timeout_ for establishing the connection and a _request timeout_
  for the full response. They guard against _hanging_ dependencies.
  Without them, a slow downstream holds threads, sockets, and memory
  until the caller's own resources run out — the classic path into
  a cascading failure. AWS Builders' Library guidance (Brooker, 2019)
  recommends timeouts on _every_ remote call, sized from the callee's
  latency distribution — typically near its p99.9 plus padding.
- **Retries with backoff and jitter** re-issue a failed request
  after a wait. They guard against _transient_ failures — partial
  outages, brief overload, flaky networks — where the same request
  has a reasonable chance of succeeding moments later. Exponential
  backoff doubles the wait each attempt; **jitter** randomizes it so
  clients do not retry in lockstep. Retries are only safe for
  idempotent operations — see §2.
- **Circuit breakers** stop calling a dependency that is failing.
  After a threshold of failures the breaker "opens" and calls fail
  fast for a cooldown period, rather than each paying a full
  timeout. They guard against _sustained_ failure: they cap the
  latency and resources a sick dependency can consume and give it
  room to recover.
- **Bulkheads** partition a service's resources — thread pools,
  connection pools, CPU or memory quotas — per dependency or per
  tenant. Named for the watertight compartments that limit flooding
  on a ship, they guard against _isolation failure_: one sick
  dependency can only exhaust its own partition, not starve
  everything else.
- **Rate limiting** caps request throughput, most often with a
  _token bucket_ — tokens refill at a fixed rate and each request
  consumes one — or a leaky-bucket queue. It guards against
  _overload_: it enforces a ceiling on demand so the system stays
  inside the capacity it was built for, rejecting or queueing the
  excess instead of melting down.
- **Load shedding** is rate limiting's reactive cousin: when a
  system detects it is saturated, it deliberately drops or cheaply
  rejects some requests — often the lowest-priority ones — to
  preserve capacity for the rest. Google SRE's "Handling Overload"
  chapter describes exactly this, including serving _degraded_
  responses and enforcing per-customer quotas.
- **Hedged requests** send a duplicate request after the first has
  not returned within a percentile-derived delay (say p95) and take
  whichever finishes first. They guard against *tail latency_:
  Dean & Barroso's "The Tail at Scale" (2013) showed that at scale a
  small fraction of very slow requests dominates user-perceived
  latency. Hedging trades extra load for latency insurance, so it
  only pays where requests are idempotent and cheap to duplicate.
- **Failover** shifts traffic to a redundant instance, zone, or
  region when the primary is unavailable. It guards against
  _site/hardware failure_ and is the coarsest-grained pattern — it
  usually lives in load balancers and DNS rather than application
  code.

The patterns compose rather than compete. A typical request passes a
rate limiter (is there budget?), enters a bulkhead (are resources
reserved?), hits a circuit breaker (is the dependency healthy?),
and is subject to a timeout and possibly retries. Ordering matters:
cheap local checks should run before expensive remote ones.

### 2. Retry semantics — idempotency, storms, and budgets

**What makes an operation safe to retry** is idempotency: performing
it N times has the same effect as performing it once. Reads and
naturally idempotent writes (PUT, DELETE) qualify; a POST that
creates a resource does not — unless the API accepts an
_idempotency key_ (a client-generated unique ID the server records
and deduplicates on), which is the standard mechanism for making
non-idempotent operations safely retryable. Brooker's AWS article
makes the same point from the failure side: a timeout does not
prove the side effect did not happen, so ambiguous outcomes must be
designed for, not assumed away.

**Retry storms and thundering herds.** When a dependency fails under
load, every client retrying at once can multiply the load and
prevent recovery — the herd that keeps the server down. Three
mechanisms contain it:

- _Exponential backoff with jitter_ spreads retries over time.
  "Full jitter" picks a random wait uniformly between zero and the
  computed cap; "decorrelated jitter" (Brooker's later AWS
  architecture post) randomizes each wait relative to the previous
  one. Both break the synchronization that pure exponential
  backoff re-creates at its cap.
- _Retry caps_ bound total attempts — typically two or three —
  because callers have their own timeouts and will give up anyway.
- _Retry budgets_ bound retries as a fraction of total traffic
  (e.g., Envoy's `retry_budget` limits concurrent retries to a
  percentage of requests), so retries can never dominate the
  workload they are trying to protect.

**The amplification math is the reason budgets exist.** Brooker's
article gives the canonical example: a five-deep call stack with
three retries at each layer produces up to 3⁵ = 243× the original
load on the failing bottom dependency. The recommended practice is
to retry at a _single_ layer of the stack — usually the outermost —
and let inner calls fail fast, rather than letting each layer
multiply the others' retries.

Retries should also be selective: retry on transient signals
(timeouts, connection resets, 5xx) and never on definitive client
errors (4xx) or on operations whose side effects cannot be
verified.

### 3. Failure isolation — circuit breakers, bulkheads, rate limiters

These three are easy to conflate because all three "stop work," but
they isolate along different axes:

| Pattern         | Axis of isolation                                          | Mechanism                                                                                                              | Typical placement                           |
| --------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Circuit breaker | _Time_ — stop spending time on a failing dependency        | State machine: closed → open after failure threshold → half-open after cooldown → trial calls decide closed or re-open | Around each downstream call, client side    |
| Bulkhead        | _Space_ — partition finite resources per dependency/tenant | Dedicated thread pools, connection pools, or quotas; exhaustion of one partition cannot starve others                  | Inside the service, around dependency calls |
| Rate limiter    | _Demand_ — cap total throughput regardless of source       | Token bucket / leaky bucket / quota; excess is rejected or queued                                                      | Edge of service or per-dependency client    |

The circuit breaker's state machine deserves precision because it is
the most commonly misimplemented pattern: in **closed** state calls
pass through and failures are counted; crossing a threshold (a
consecutive-failure count, or better, an error-rate over a sliding
window) trips it **open**, where calls fail immediately without
touching the dependency; after a cooldown it moves to
**half-open**, admitting a limited number of trial requests —
successes close it, failures re-open it. Sophisticated breakers
(Fowler's article; Envoy's implementation) also distinguish error
types — e.g., a low threshold for connection failures, a higher one
for timeouts — and expose state transitions as metrics and alerts,
because a tripping breaker is itself a symptom worth paging on.

Composition is layered, not either/or: rate limiting shapes demand
before it reaches the service; bulkheads guarantee a sick dependency
cannot consume the pools other dependencies need; circuit breakers
stop the remaining traffic to a dependency that is already failing;
retries sit innermost, bounded by all of the above. Envoy's docs
illustrate the same layering at the infrastructure level — its
circuit breakers cap connections, pending requests, parallel
requests, and retries per upstream cluster, enforced at the proxy
rather than in each application.

### 4. Graceful degradation — defined behavior when things fail

"Degrade gracefully" is meaningless unless the degraded behavior is
_decided in advance_. Google SRE's "Handling Overload" chapter is
the clearest articulation: under load, serve degraded responses —
search a subset of the corpus, answer from a local cache that may
be slightly stale, return partial results — and only when even
that is too expensive, serve fast errors. Nygard calls the same
idea "fail fast" and "shed load."

Concrete degradation strategies, roughly in increasing order of
severity:

- **Stale-but-usable data**: serve cached results with a visible
  freshness indicator rather than failing the request.
- **Reduced functionality**: disable non-essential features
  (recommendations, personalization) via feature flags while core
  flows continue.
- **Queued work**: accept the request, persist it, and process
  asynchronously — viable only when the operation is idempotent
  and the user can tolerate delay (order confirmation, report
  generation), never for interactive reads.
- **Fast failure**: return an immediate, well-formed error instead
  of a timeout — honest UI beats a spinner that never resolves.

**Health probes** are the mechanism that lets orchestration act on
these states. Kubernetes' three probes model the standard split
(see the Kubernetes docs): _startup_ probes keep a slow-booting
container alive until it is ready; _liveness_ probes detect a hung
or dead process and trigger a restart; _readiness_ probes detect a
process that is alive but unable to serve — drained connections,
missing config — and remove it from the load balancer without
killing it. The discipline that matters: probes must be cheap,
must not depend on the same failing dependency they are meant to
isolate (a readiness check that calls the sick database will flap
with it), and must have failure thresholds tuned so transient
blips do not cause restart storms.

### 5. Verifying resilience — testing failure rather than assuming it

Resilience that has never been exercised is a hypothesis, not a
property. The industry-standard framework is **chaos engineering**,
codified in the Principles of Chaos Engineering (2019): formulate a
hypothesis about _steady-state_ behavior (measurable outputs like
latency percentiles and error rates, not internal attributes),
introduce real-world failure variables, and try to disprove the
hypothesis — continuously, in production, with the blast radius
minimized.

The canonical lineage is Netflix: the 2011 "Simian Army" post
describes Chaos Monkey randomly terminating production instances
during business hours with engineers standing by, and Latency
Monkey injecting artificial delays into the communication layer —
the insight being that you only learn whether your spare tire
works by changing the flat tire on a Sunday afternoon. Modern
tooling (Chaos Monkey on GitHub, Litmus, Gremlin, AWS Fault
Injection Simulator) generalizes this to instance, network,
dependency, and resource failures.

The practical verification stack has four layers:

- **Failure-path unit/integration tests** — every fallback branch,
  breaker state transition, and degraded response is code that can
  be wrong; test it like the happy path. SRE's "Testing for
  Reliability" chapter makes the broader point that tests reduce
  the uncertainty of change, and a fallback you never test is a
  fallback that does not exist.
- **Fault injection in test/staging** — proxies and service
  meshes can add latency, drop packets, and return errors on
  demand (Envoy supports fault injection; tools like Toxiproxy do
  the same for arbitrary TCP dependencies). This is the cheapest
  way to verify timeout and retry behavior deterministically.
- **Game days / disaster recovery exercises** — Nygard's
  _Release It!_ devotes a chapter to simulated disasters:
  scheduled, staffed events where a real failure is injected and
  the team practices detection and recovery. They test the
  _organizational_ resilience — runbooks, on-call response — that
  no automated test can.
- **Continuous chaos in production** — small, automated,
  blast-radius-limited experiments (kill one instance, drain one
  zone) that verify recovery mechanisms daily rather than once a
  year. The Netflix model: failures should be unremarkable
  events, not surprises.

The meta-rule across all four: resilience claims should be
_evidenced_ — measured recovery times, observed fallback behavior,
documented game-day outcomes — not asserted in design documents.

### Sources

- Brooker, ["Timeouts, retries, and backoff with jitter" (2019)](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/);
  ["Exponential Backoff and Jitter" (2015)](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/);
  Nygard, [_Release It!_, 2nd ed. (2018)](https://www.oreilly.com/library/view/release-it-2nd/9781680504552/)
- Fowler, ["Circuit Breaker" (2014)](https://martinfowler.com/bliki/CircuitBreaker.html);
  [Envoy — Circuit breaking](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking);
  [Envoy — Global rate limiting](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_features/global_rate_limiting);
  [Polly resilience library](https://www.pollydocs.org/)
- Google SRE Book — ["Handling Overload" (2016)](https://sre.google/sre-book/handling-overload/),
  ["Addressing Cascading Failures" (2016)](https://sre.google/sre-book/addressing-cascading-failures/),
  ["Testing for Reliability" (2016)](https://sre.google/sre-book/testing-reliability/);
  [Kubernetes — Liveness, readiness, and startup probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Principles of Chaos Engineering (2019)](https://principlesofchaos.org/);
  Izrailevsky & Tseitlin, ["The Netflix Simian Army" (2011)](https://netflixtechblog.com/the-netflix-simian-army-16e57fbab116);
  [Netflix Chaos Monkey](https://github.com/Netflix/chaosmonkey)
- Dean & Barroso, ["The Tail at Scale" (2013)](https://research.google/pubs/pub40801/)
