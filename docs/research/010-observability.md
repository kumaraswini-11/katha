# ADR-010: Observability

## Status

Question approved — answer drafted (under review)

## The Question

How should a distributed microservices system be observed — what
telemetry is needed, how is it correlated across services, and
which observability stack fits which context?

1. **The three pillars.** What do logs, metrics, and traces each
   answer — what are their costs, and how do they correlate into
   one coherent picture of system behavior?

2. **Distributed tracing.** How does a single request get tracked
   across service boundaries — trace context propagation, span
   instrumentation, sampling strategies? What does a trace reveal
   that logs and metrics cannot?

3. **Logging in distributed systems.** What makes logs useful at
   scale rather than noise — structured formats, correlation IDs,
   consistent log levels, and the discipline of never logging
   secrets or PII?

4. **Metrics, SLOs & alerting.** Which metrics matter — RED vs.
   USE methods; how do SLIs, SLOs, and error budgets drive
   engineering priorities; and how is alert fatigue avoided
   without missing real signals?

5. **Implementation choices.** What are the options — OpenTelemetry
   as the standard, vendor backends vs. self-hosted, instrumentation
   libraries per language — and what does observability cost at
   scale?

---

## Answer

### 1. The three pillars — what each one answers, and what it costs

The "three pillars" framing — logs, metrics, traces — is a useful
checklist of telemetry _types_, though observability practitioners
(Honeycomb's writing, Charity Majors' work) argue the pillars are
components, not the goal: observability is the ability to ask
novel questions of production behavior, which requires correlating
all three.

- **Logs** are discrete, timestamped events — "what happened."
  Each entry carries context (user ID, request ID, error detail)
  that makes individual incidents debuggable. Costs: highest
  volume and cardinality of the three; unstructured logs are
  unqueryable noise; storage and ingestion dominate observability
  bills at scale.
- **Metrics** are numeric aggregates over time — counters,
  gauges, histograms. They answer "how much, how fast, how often"
  and are cheap to store and fast to aggregate, which is why
  alerting and dashboards run on them. The cost: aggregation
  destroys per-request detail — a p99 latency metric cannot tell
  you _which_ request was slow.
- **Traces** capture the causal path of one request across
  services — "where did the time go, where did it fail." They
  answer questions neither logs nor metrics can, at a volume
  between the two (manageable with sampling).

**Correlation** is what turns three data types into one picture.
The mechanism is shared identifiers: every log line emitted during
a request carries the request's `trace_id` (and `span_id`), so a
log entry can be pulled up inside its trace; metrics can carry
trace exemplars — links from an aggregated data point to a real
trace instance; and span events are, in effect, structured logs
scoped to a span. OpenTelemetry's context-propagation model is
the industry mechanism that makes this automatic rather than
convention.

### 2. Distributed tracing — following one request across boundaries

**The data model.** A trace is a tree (or DAG) of **spans**. Each
span records: a name, a `trace_id` shared by the whole trace, its
own `span_id`, the `parent` span's ID (absent on the root),
start/end timestamps, attributes (key-value metadata like
`http.route`, `db.statement`), timestamped events, a status, and
links to related traces. OpenTelemetry's docs use the apt framing:
a span is "a structured log with context, correlation, hierarchy,
and more baked in" — except spans from different processes can be
assembled into one causal picture.

**Propagation.** The W3C Trace Context specification (a W3C
Recommendation since 2021) standardizes the wire format:
`traceparent: 00-<trace-id>-<parent-id>-<trace-flags>` carries the
trace ID, the caller's span ID (becoming the callee's parent), and
flags including the sampled bit; `tracestate` carries optional
vendor-specific key-value pairs. The mechanism is inject/extract:
the caller's instrumentation serializes the current span context
into outgoing HTTP/gRPC/message headers; the callee's
instrumentation extracts it and parents its new spans under it.
Because the format is vendor-neutral, a trace survives crossing
between different vendors' tooling — the original problem the
specification was written to solve.

**Instrumentation.** Two levels: _auto-instrumentation_ (agents
and libraries that patch frameworks — HTTP servers, database
clients, message consumers — and create spans with no code
changes) and _manual_ spans for business operations the framework
cannot see ("checkout," "fraud-check"). OpenTelemetry's semantic
conventions standardize attribute names (`http.route`, `db.system`)
so spans from different services are comparable.

**Sampling.** Tracing every request is often too expensive, so
samplers decide which traces are recorded:

- _Head sampling_ decides at trace start — typically a
  deterministic percentage keyed on the trace ID ("consistent
  probability sampling"), so all spans of a trace are kept or
  dropped together. Cheap and simple, but blind: it cannot know
  whether the trace will end in an error.
- _Tail sampling_ buffers spans until the trace completes, then
  decides with full knowledge — keep every trace containing an
  error or exceeding a latency threshold, sample the healthy
  remainder. Far more useful signal per byte stored, but requires
  stateful buffering infrastructure and careful operation.
  OpenTelemetry's docs note the two are often combined: head
  sampling protects the pipeline from volume, tail sampling
  makes the final keep/drop decision.

**What traces reveal that the other pillars cannot:** the exact
sequence and timing of every hop for _one_ request — which
downstream call consumed the latency, which service returned the
error, how fan-out amplified a slow dependency. Metrics show that
p99 rose; only a trace shows _why_, for a specific request.

### 3. Logging in distributed systems — signal, not noise

Four disciplines separate useful logs from noise at scale:

- **Structured format.** JSON (or another key-value encoding)
  with consistent field names. Unstructured prose cannot be
  filtered, aggregated, or correlated — it is write-only
  archaeology. Structured logs become queryable: "all ERROR
  lines for trace_id X" is a lookup, not a grep-and-pray.
- **Correlation IDs.** Every log line emitted while serving a
  request should carry the request's trace/span IDs (OpenTelemetry
  SDKs inject these automatically) so logs interleave correctly
  with traces. For paths without tracing, a per-request
  correlation ID propagated through headers serves the same
  purpose.
- **Disciplined levels.** ERROR means "actionable failure" —
  something a human or system should respond to. WARN is
  degraded-but-handled. INFO is the default narrative. DEBUG is
  off in production. The level is also the volume control:
  raising a service to DEBUG during an incident is the standard
  diagnostic move, and misusing levels (ERROR for handled
  conditions) destroys the signal.
- **Never log secrets or PII.** Tokens, passwords, session
  cookies, card numbers, and personal data must be scrubbed at
  the source or in the collection pipeline — logs are copied to
  many systems and retained far longer than the request that
  produced them. OpenTelemetry's own context-propagation docs
  warn that even propagated baggage can leak sensitive data to
  untrusted downstream services; the same discipline applies to
  log fields.

Two economic notes: high-volume success paths are candidates for
sampling or aggregation before export, and because logs dominate
ingestion spend, "log everything" is a budget decision, not a
default.

### 4. Metrics, SLOs & alerting — from numbers to priorities

**Two complementary metric methods.** Brendan Gregg's **USE
method** — for every _resource_, check Utilization, Saturation,
and Errors — applies to infrastructure: CPU, memory, disks,
network. Tom Wilkie's **RED method** — for every _service_,
measure Rate, Errors, and Duration — applies to request-driven
software and is the better proxy for user-perceived health;
Grafana's write-up describes it as "caring about your users" while
USE cares about "your machines." Google SRE's four golden
signals (latency, traffic, errors, saturation) are the same
insight stated for services.

**SLI → SLO → SLA.** An SLI is the quantitative _indicator_ (e.g.,
"fraction of requests served in under 300 ms"), an SLO is the
target or range for it ("99.9% of requests under 300 ms over 30
days"), and an SLA is the contractual _agreement_ with consequences
attached. The SRE book's framing matters because it converts
vague "reliability" into arithmetic: a 99.9% monthly SLO implies
an error budget of about 43 minutes of badness per month — the
spendable allowance that decides whether a release ships or a
postmortem happens.

**Alerting on budgets, not causes.** Google's SRE Workbook
("Alerting on SLOs") walks through increasingly sophisticated
rules and lands on burn-rate alerting: page when the error-budget
burn rate is high enough that the budget will be exhausted before
the window ends — e.g., a fast-burn alert at 14.4× budget
consumption for one hour, a slow-burn alert at 6× for six hours.
Alert on _symptoms users experience_ (the SLI being violated),
not _causes_ (CPU at 80%) — a cause-based alert fires on problems
that may not matter, and misses problems that do.

**Avoiding alert fatigue.** The SRE book is blunt: paging a human
is the most expensive alert channel — it interrupts work or
sleep — so every page must be actionable. Its guidance: alerts
should have good signal and very low noise; "something seems a
bit weird" is never a reason to page. The Workbook quantifies the
design trade-offs as precision (fraction of alerts that were
significant), recall (fraction of significant events detected),
detection time, and reset time — the fast-burn/slow-burn pair
exists precisely to balance them. Practically: route warnings to
tickets/dashboards, reserve pages for budget-threatening events,
and delete or retune any alert that repeatedly fires without
action.

### 5. Implementation choices — OpenTelemetry and the cost model

**The standard layer.** OpenTelemetry (OTel) is the vendor-neutral
open standard for all three signals: instrumentation APIs/SDKs
per language, semantic conventions for attribute names, the
propagators that implement W3C Trace Context, and the
**Collector** — a standalone pipeline that receives telemetry,
processes it (batching, sampling, attribute filtering), and
exports it to any backend. The strategic value: instrumentation
is written once against OTel and the backend becomes a
configuration choice, not a rewrite.

**Instrumentation options**, in increasing effort: _zero-code_
instrumentation (auto-instrumentation agents that patch common
frameworks — fastest coverage, least control), _library_
instrumentation (framework-provided spans for HTTP, DB, queues),
and _manual_ SDK spans for business-level operations. The
practical recipe is auto-instrumentation for coverage plus manual
spans at the handful of operations that define the service's
critical paths.

**Backends.** Two families: vendor SaaS (Honeycomb, Datadog,
New Relic, Grafana Cloud) — managed, fast time-to-value, priced
per GB/host — versus self-hosted open source (Prometheus +
Grafana for metrics; Jaeger, Tempo, or Zipkin for traces; Loki
for logs) — no per-GB telemetry fees but you own the operational
cost of running and scaling the storage. The OTel Collector
bridges them: the same instrumentation can feed either, and
hybrid deployments (metrics to Prometheus, traces to a vendor)
are common.

**What observability costs at scale** is dominated by three
drivers:

- _Metric cardinality_ — Prometheus's data model makes every
  unique label set a distinct time series; a label like
  `user_id` or `request_id` on a metric explodes storage and
  query cost. High-cardinality dimensions belong in traces and
  logs, not metric labels.
- _Log volume_ — the highest per-byte cost; control via sampling,
  level discipline, and field allowlists.
- _Trace volume_ — controlled by sampling (head for cheap
  uniform coverage, tail for error/latency-biased coverage) and
  by span granularity (auto-instrumented DB and HTTP spans add
  up fast).

The durable pattern: instrument with OpenTelemetry, collect and
sample in the Collector, keep cardinality and sampling policies
as explicit configuration, and choose the backend for the query
patterns and budget you actually have — because the instrumentation
layer is the part that is expensive to change later.

### Sources

- [OpenTelemetry documentation](https://opentelemetry.io/docs/) —
  [traces](https://opentelemetry.io/docs/concepts/signals/traces/),
  [context propagation](https://opentelemetry.io/docs/concepts/context-propagation/),
  [sampling](https://opentelemetry.io/docs/concepts/sampling/);
  [W3C Trace Context (2021)](https://www.w3.org/TR/trace-context/)
- Google SRE Book — ["Monitoring Distributed Systems" (2016)](https://sre.google/sre-book/monitoring-distributed-systems/),
  ["Service Level Objectives" (2016)](https://sre.google/sre-book/service-level-objectives/);
  SRE Workbook — ["Alerting on SLOs" (2018)](https://sre.google/workbook/alerting-on-slos/)
- Gregg, ["The USE Method"](https://www.brendangregg.com/usemethod.html);
  Wilkie/Dam, ["The RED Method: How to Instrument Your Services" (2018)](https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/)
- [Prometheus — data model](https://prometheus.io/docs/concepts/data_model/);
  [Honeycomb — "What Is Observability?"](https://www.honeycomb.io/what-is-observability)
