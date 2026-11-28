# ADR-012: Service Language & Runtime Selection

## Status

Question approved — answer drafted (under review)

## The Question

When building backend microservices, how should the implementation
language and runtime be chosen for each service — and should all
services share one language or may they differ?

1. **The candidate landscape.** Which languages and runtimes are
   realistic choices for microservices — JVM languages, Go,
   Node.js/TypeScript, .NET, Rust, Python, and others? What is each
   one's inherent profile — performance, concurrency model, ecosystem
   and library maturity, startup time, memory footprint, hiring pool?

2. **The selection criteria.** Which factors legitimately drive the
   choice — workload type (I/O-bound vs. CPU-bound), throughput and
   latency requirements, domain ecosystem fit, team expertise, hiring
   and onboarding, operational uniformity, serverless/cold-start
   constraints?

3. **Uniform vs. polyglot.** When is one language across all services
   the right call, and when does best-tool-per-service (polyglot)
   pay off? What does polyglot actually cost — shared libraries,
   hiring, cognitive load, observability, deployment pipelines?

4. **The frontend/backend boundary.** Where do frontend frameworks
   and server-side rendering fit — is a frontend framework ever a
   valid service implementation language, or always a separate tier?

---

## Answer

### 1. The candidate landscape

The realistic candidates for backend services fall into about six
runtime families. What actually distinguishes them is not syntax
but the **runtime mechanism** underneath — how code is executed,
how concurrency is scheduled, and how memory is managed. Those
mechanisms determine startup time, memory footprint, tail latency,
and which workloads each can handle well.

**Go** — compiles ahead-of-time to a single static binary: no VM,
no interpreter, no runtime install. Concurrency is built around
**goroutines**, lightweight tasks multiplexed onto a small pool of
OS threads by the runtime's scheduler using an **M:N model** — M
OS threads ("machines") bound to P logical processors (one per
core), with G goroutines distributed across them. A goroutine
blocked on a channel or syscall never blocks its thread-mates;
the runtime simply schedules another G onto that M. Goroutine
stacks start at a few KB and grow and shrink on demand, versus
megabyte-sized OS thread stacks — which is why one Go process
comfortably hosts hundreds of thousands (and in principle
millions) of concurrent tasks. Memory is managed by a **concurrent
tri-color mark-sweep garbage collector** — it mostly runs alongside
the program with brief stop-the-world pauses typically measured in
microseconds to low milliseconds; Rick Hudson's ISMM 2018 keynote
documents how obsessively the design targets tail latency. The
trade-offs: GC pauses exist (bounded, but nonzero), the language is
deliberately spartan (verbose error handling, generics only since
1.18), and the ecosystem is younger than JVM or Python for data
and ML work. The deployment profile is superb: binaries start in
milliseconds, idle in tens of MB, and ship in ~10–20 MB images.

**JVM languages (Java, Kotlin, Scala, Clojure)** — compile to
bytecode executed by a virtual machine with a **JIT compiler**.
The JIT is both the strength and the defining problem: code starts
interpreted or lightly compiled and is promoted to optimized
machine code as it gets hot (HotSpot's C1/C2 tiered compilation).
A freshly started JVM is slow until warmup traffic teaches it
which paths matter — a real production concern addressed by warmup
pings, slow-start load balancing, or platform-level snapshot
restore (AWS Lambda SnapStart, OpenJDK's CRaC). Memory uses a
generational GC: G1 (the default) delivers pause times in the tens
of milliseconds at large heaps; ZGC and Shenandoah push pauses
below a millisecond at the cost of more memory and CPU overhead.
**Virtual threads** (Java 21, JEP 444) add Go-style lightweight
concurrency — millions of virtual threads multiplexed onto a small
set of carrier threads — eliminating the thread-per-connection
memory problem for I/O-bound code. The footprint is the heaviest
of the mainstream options: a bare JVM idles in tens of MB, a
typical enterprise service sits in the hundreds of MB, and cold
starts run from under a second to several seconds depending on
framework weight. The payoff: the largest package ecosystem of any
language, the deepest enterprise hiring pool, and the most mature
clients for databases, message brokers, and observability.

**Node.js / TypeScript** — V8 JIT-compiled JavaScript on a
**single-threaded event loop**. All JavaScript runs on one
thread; I/O is offloaded to the OS kernel through **libuv**, whose
internal thread pool (4 threads by default, tunable via
`UV_THREADPOOL_SIZE` up to 1024) handles only non-JS work —
filesystem, DNS, crypto, compression — never arbitrary application
code. The event loop cycles through phases (timers → pending
callbacks → poll → check → close callbacks) and runs each callback
to completion, so **any CPU-bound JavaScript blocks every
concurrent request** — the model's central failure mode. CPU work
must leave the main thread via `worker_threads` (separate V8
isolates) or child processes. This makes Node excellent for
I/O-bound services — APIs, proxies, JSON-heavy real-time
workloads — and weak for CPU-heavy ones. Startup is fast and the
baseline footprint is moderate (tens of MB). TypeScript adds a
compile step but is the same runtime; npm is the largest package
registry, and JavaScript/TypeScript is consistently the
most-used language in developer surveys — the deepest hiring
pool alongside Python and Java.

**.NET (C# / F#)** — the CLR, architecturally a JVM cousin: IL
bytecode, tiered JIT, generational GC. Its differentiators are
deployment options: **ReadyToRun** pre-compiles hot paths at
publish time to cut JIT warmup, and **NativeAOT** compiles all the
way to native code — the fastest startup and smallest footprint
of the managed runtimes, at the cost of restricted dynamic
features (reflection-heavy libraries need trimming and AOT
annotations). ASP.NET Core's Kestrel is a high-performance,
cross-platform HTTP server. Footprint and startup sit between
Node and JVM defaults; maturity and enterprise tooling are
strong, particularly on Azure and Windows estates.

**Rust** — compiles ahead-of-time to native code with **no
garbage collector**. Memory safety is enforced at compile time by
the **ownership and borrow checker**: every value has exactly one
owner, borrows are checked statically, and the compiler rejects
use-after-free, data races, and double frees — GC-grade safety
without a runtime. "Zero-cost abstractions" means generics and
iterators compile to the same machine code a hand-written C
version would. Concurrency is explicit: `async`/`.await` state
machines driven by a runtime (Tokio is the standard) that
schedules tasks across OS threads with a work-stealing algorithm
over OS async I/O. The result is predictable latency — no GC
pauses, ever — and the smallest footprints of any candidate (a
minimal service runs in a few MB). The costs are equally real:
compilation is slow (LLVM codegen; dependency-heavy builds take
minutes), the borrow checker has a genuine learning curve, the
ecosystem is the youngest of the mainstream set, and async Rust
still has rough edges (cancellation, async traits, self-referential
futures). Rust wins where latency, memory, or safety-per-cycle is
the binding constraint — proxies, edge components, CPU-bound
services — and loses on iteration speed.

**Python** — CPython executes bytecode in an interpreter,
delegating heavy lifting to optional C extensions. The defining
mechanism is the **GIL**: only one thread may execute Python
bytecode at a time, so threads provide concurrency for I/O-bound
work (via `asyncio`'s event loop) but **no parallelism for
CPU-bound Python code**. Real parallelism requires
`multiprocessing` — separate interpreters with separate heaps,
paying serialization and memory costs per process — or native
extensions that release the GIL. The free-threaded build (PEP
703, experimental since Python 3.13) removes the GIL entirely at
some single-threaded performance cost. Startup is fast for bare
scripts and slower once web frameworks load; footprints are
small-to-moderate. Python's decisive advantage is its ecosystem:
it is the lingua franca of data, ML, and AI — the scientific
stack simply doesn't exist elsewhere — which makes it the default
for any service touching analytics, model inference, or
scientific computing, and a perfectly adequate choice for
ordinary CRUD APIs.

**Worth a mention but rarely the default:** Elixir/Erlang (the
BEAM VM — preemptive actor scheduling and "let it crash"
supervision trees, superb for stateful real-time systems, small
hiring pool); PHP and Ruby (developer-experience leaders whose
concurrency models and share of new microservice work have
waned); Crystal and Zig (systems languages with young
ecosystems). Valid when a specific workload demands them, not
general-purpose defaults.

| Runtime | Execution           | Concurrency mechanism                     | Cold start | Idle footprint | Natural fit                  |
| ------- | ------------------- | ----------------------------------------- | ---------- | -------------- | ---------------------------- |
| Go      | AOT native, GC      | M:N goroutine scheduler                   | ~ms        | tens of MB     | cloud-native services, infra |
| JVM     | bytecode + JIT, GC  | OS threads / virtual threads              | ~0.5–2s+   | 100s of MB     | enterprise, data-heavy       |
| Node.js | V8 JIT, GC          | single-thread event loop + worker threads | ~100ms–1s  | tens of MB     | I/O-bound APIs, JSON         |
| .NET    | IL + JIT, GC        | thread pool / async                       | ~0.2–1s    | tens–100s MB   | enterprise, Azure            |
| Rust    | AOT native, no GC   | explicit async tasks                      | ~ms        | a few MB       | latency/memory-critical      |
| Python  | bytecode interp, GC | GIL + asyncio / processes                 | ~0.1–1s    | tens of MB     | data/ML, scripting           |

(Timings are typical for a real service, not a hello-world; they
vary enormously with framework weight and heap sizing.)

### 2. The selection criteria

Each criterion below is really a question about which runtime
mechanism matters for _this_ service:

**Workload type — the first filter.** I/O-bound services (most
APIs: proxying, CRUD, fan-out calls, waiting on databases and
other services) spend their time waiting, so nearly every runtime
handles them — the differentiator shifts to ecosystem and team.
CPU-bound services (image or media processing, ML inference,
heavy parsing, crypto, compression) need _real parallelism_
across cores, and the runtimes differ sharply: Rust, Go, JVM, and
.NET parallelize across OS threads natively; Node must escape the
event loop to worker threads or processes; Python threads don't
parallelize at all (GIL), forcing processes or native extensions.
Even "I/O-bound" services have CPU bursts — JSON serialization at
high throughput, TLS termination — so throughput requirements can
promote a service into CPU-bound territory at scale.

**Throughput & latency.** The TechEmpower Framework Benchmarks —
admittedly synthetic, single-machine tests — consistently place
Rust, Go, JVM, and .NET frameworks an order of magnitude or more
ahead of Node and Python on CPU-heavy tests; the gap narrows when
the workload is dominated by I/O wait, which is most real traffic.
For latency specifically, watch **tail latency from the memory
manager**: Go's GC pauses in the low milliseconds, G1 in the tens
of milliseconds (ZGC and Shenandoah below one), Python's GIL
serializes threaded CPU work, and Rust has no GC pauses at all. If
your SLO is p99 under load, the runtime's pause behavior is a
first-order input, not a footnote.

**Domain ecosystem fit.** Often decisive and underestimated: a
data pipeline wants the scientific stack (Python); a service
integrating with enterprise systems wants the mature
JDBC/Kafka/Oracle clients (JVM/.NET); a cloud-infrastructure
component wants Go's deployment model and networking libraries;
a latency-critical edge proxy wants Rust. Choosing against the
ecosystem means reimplementing what the default choice gives you
for free.

**Team expertise & hiring.** The most predictive factor for
delivery success is not benchmark scores but whether the team can
write, debug, and operate the code. Stack Overflow's annual survey
consistently shows JavaScript/TypeScript, Python, and Java as the
most-used languages — the deepest hiring pools — with Go and C#/.NET
mid-sized and Rust smaller but growing. An unfamiliar language
costs velocity, raises defect rates, and thins the on-call bench;
a well-known language with adequate performance usually beats a
"better" language nobody on the team knows.

**Operational uniformity.** One runtime means one toolchain, one
debugger, one APM/profiler agent, one container pattern, one
capacity model, one runbook. Polyglot multiplies every one of
those — see §3.

**Cold start / serverless constraints.** On scale-to-zero
platforms you pay for every cold start: container fetch + runtime
init + JIT warmup + first-request latency. The rough ordering:
Rust and Go fastest (milliseconds), Node and Python next, .NET
moderate, JVM slowest (seconds) unless mitigated — JVM
snapshot-restore (SnapStart, CRaC), GraalVM native image, or
simply keeping minimum instances warm. The memory floor matters
too: you are billed for provisioned memory during init, so a
500 MB JVM baseline costs more per cold start than a 20 MB Go
binary even at equal startup time.

**The decision rule:** start from the boring end — the language
the team already knows that adequately fits the workload — and
only reach for a second language when a service's profile
genuinely diverges (§3).

### 3. Uniform vs. polyglot

**Uniform (one language everywhere)** buys: libraries and
utilities that are actually shared rather than reimplemented,
one hiring profile, one debugging and observability story, one CI
pattern — and, underrated, **shared mental models**: every service
fails the same way, so on-call patterns transfer. Its cost: the
language must be adequate-but-not-optimal for every workload; a
CPU-bound service in a language weak at CPU work becomes a
recurring performance fire.

**Polyglot (best tool per service)** buys genuine fit for
genuinely different workloads — a Python ML service beside a Go
gateway beside a Rust edge component is a coherent architecture,
not chaos. But the costs are structural, not cosmetic:

- **You cannot share code — only contracts.** Libraries,
  utilities, and types do not cross language boundaries. What
  crosses is the _contract_: protobuf/gRPC schemas, OpenAPI
  specs, JSON Schema, AsyncAPI event definitions — versioned,
  compatibility-checked, and generated into each language's
  client. Contract discipline becomes the entire integration
  strategy; a breaking contract change is now an N-language
  coordinated release.
- **Hiring and bus factor multiply.** Each language needs
  coverage on every relevant on-call rotation. A niche language
  can put operational knowledge in one or two heads — an
  unacceptable key-person risk at small team sizes.
- **Observability fragments.** OpenTelemetry provides
  language-agnostic traces, metrics, and logs — the single best
  mitigation — but profilers, heap dumps, flame graphs, and APM
  agents remain per-runtime. Debugging a production incident in
  a language your on-call engineer doesn't know is slow and
  scary.
- **Cognitive load.** Every service's idioms, failure modes, and
  debugging tools differ; polyglot teams measurably experience
  slower incident response.
- **CI/CD cost is smaller than feared** — containers abstract the
  runtime, so pipelines build, test, and package any language
  uniformly. The real polyglot tax is in the code, not the
  deploy.

**When polyglot pays:** when services have genuinely different
workload profiles _within one system_ — CPU-heavy processing next
to I/O-heavy APIs, ML inference next to latency-critical routing,
memory-constrained edge next to cloud-scale services. The
legitimate test is "this service's workload is different enough
that no single language is good at both" — not "this service is
new and I fancy a different language."

**When uniform wins:** CRUD-dominated service fleets where no
workload is extreme; small teams; any situation where
operational simplicity dominates marginal performance. Most
production systems converge on **one to three languages**, with
the large majority on one default.

**The practical middle path** — what mature polyglot shops
actually do: a **default-language policy** (new services must
justify deviation, ideally via an ADR), contract-first APIs so
exceptions are cheap to integrate, and a shared observability
baseline (OpenTelemetry everywhere). "Uniform at the boundary,
varied inside" — every service speaks the same contract style
and ships the same way even if internals differ.

### 4. The frontend/backend boundary

First, a clarification that dissolves most of the confusion:
**SSR frameworks run on server runtimes.** Next.js, Nuxt,
SvelteKit, Remix — these are server-side JavaScript/TypeScript
applications. The "frontend framework" is not a different
language from Node.js; it is a _framework_ running _on_ a
runtime. So the real question isn't frontend-vs-backend language —
it's **presentation tier vs. service tier**.

**Where the SSR tier legitimately is a service:** the
backend-for-frontend (BFF) pattern — an SSR app that aggregates
several backend APIs, shapes responses for one client type, and
renders HTML — is a real service with its own deploy lifecycle.
Route handlers and server actions in modern frameworks are just
HTTP handlers; they can and do implement APIs. Nothing technically
stops you from writing domain logic there.

**Why it still shouldn't hold domain services:** the framework is
a _delivery mechanism_, not a service architecture. Business
logic inside SSR components couples your domain rules to a UI
framework's rendering lifecycle, makes the logic un-reusable by
non-web clients (mobile apps, CLIs, and partner integrations
can't consume your component tree), and entangles service
releases with frontend releases — the opposite of independent
deployability. Domain services must exist independently of any
presentation tier because multiple presentation tiers will
consume them.

**The edge-runtime wrinkle:** platforms like Cloudflare Workers
and Vercel Edge run JavaScript on **V8 isolates** — not Node, not
threads. Isolates are lighter than processes (no shared heap
between requests), start in sub-milliseconds through reuse, and
impose constraints: no arbitrary sockets, per-request CPU-time
budgets, a limited Node API surface. Choosing "edge" means
choosing a different runtime contract — powerful for cacheable,
low-latency, globally distributed workloads; wrong for
long-lived connections or CPU-heavy work.

**The rule:** frontend and SSR frameworks are valid for
rendering, aggregation, and BFF-tier APIs — and the BFF tier is
itself a legitimate service. But domain services — the ones
owning business logic, data, and contracts that multiple clients
consume — belong in a service tier with their own runtime,
deployable independently of any UI. A frontend framework can
never be the implementation of a domain service; it can only be
a client of one — plus the legitimate exception of the BFF,
which exists _to serve_ clients rather than to own the domain.

**Bottom line:** pick the boring language the team already knows
that adequately fits the workload; reach for Go, Rust, JVM, or
Python only when a service's profile genuinely demands their
mechanism. Uniform beats polyglot until the workloads prove
different — and even then, contracts and a default-language
policy keep the exceptions cheap.

### Sources

- Go runtime & GC: [Effective Go — concurrency](https://go.dev/doc/effective_go);
  [The Go Blog — "Getting to Go: The Journey of Go's Garbage Collector" (2018)](https://go.dev/blog/ismmkeynote);
  [Go Tour — concurrency](https://go.dev/tour/concurrency/1)
- JVM & .NET runtimes: [JEP 444 — Virtual Threads](https://openjdk.org/jeps/444);
  [JEP 439 — Generational ZGC](https://openjdk.org/jeps/439);
  [Microsoft Learn — .NET garbage collection](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/);
  [Microsoft Learn — Native AOT deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/);
  [Microsoft Learn — Kestrel web server](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel)
- Node.js & Python runtimes: [Node.js docs — the event loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick);
  [Node.js API — worker_threads](https://nodejs.org/api/worker_threads.html);
  [Node.js CLI — environment variables (UV_THREADPOOL_SIZE)](https://nodejs.org/api/cli.html);
  [Python glossary — GIL](https://docs.python.org/3/glossary.html#term-global-interpreter-lock);
  [Python asyncio documentation](https://docs.python.org/3/library/asyncio.html);
  [PEP 703 — Making the GIL Optional in CPython](https://peps.python.org/pep-0703/)
- Rust: [The Rust Programming Language — ownership](https://doc.rust-lang.org/book/);
  [Async Rust book](https://rust-lang.github.io/async-book/)
- Cross-language & ecosystem: [TechEmpower Framework Benchmarks](https://www.techempower.com/benchmarks/);
  [Stack Overflow Developer Survey](https://survey.stackoverflow.co/);
  [OpenTelemetry documentation](https://opentelemetry.io/docs/);
  [gRPC documentation](https://grpc.io/docs/)
