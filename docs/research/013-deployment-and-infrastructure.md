# ADR-013: Deployment & Infrastructure

## Status

Question approved — answer drafted (under review)

## The Question

How should microservices be packaged, deployed, and operated —
containers, orchestration, environments, and delivery pipelines —
and which infrastructure choices fit which context?

1. **Packaging.** What does production-grade packaging look like —
   containers and OCI images, minimal/distroless base images,
   image size and security scanning, reproducible builds?

2. **Orchestration.** Which runtime platforms exist — Kubernetes,
   simpler orchestrators, managed container services,
   serverless containers — and when does Kubernetes earn its
   operational complexity versus simpler alternatives?

3. **CI/CD & delivery.** How should services be built and shipped —
   build once deploy many, per-service pipelines, progressive
   delivery (canary, blue-green), automated rollbacks? What does
   independent deployability require of the pipeline?

4. **Environments & configuration.** How are dev/staging/prod kept
   consistent — environment parity, configuration management,
   GitOps, feature flags? (Secrets management is covered in
   ADR-008.)

5. **Scaling & resource management.** How do services scale —
   horizontal pod autoscaling, resource requests and limits,
   cost optimization, capacity planning?

---

## Answer

### 1. Packaging

Production-grade packaging means producing a **container image** —
an OCI artifact — that is immutable, minimal, reproducible, and
scanned. Understanding what is actually inside the artifact makes
the rest of the decisions obvious.

**What an image actually is.** Under the OCI Image Specification,
an image is a manifest plus a config JSON plus a list of
_content-addressable layers_ — filesystem diffs stacked by an
overlay filesystem (overlayfs on Linux). The runtime doesn't see
"files" so much as a chain of layer tarballs it unpacks and
mounts. This layering is why image _size_ matters mechanically:
shared base layers are pulled and unpacked once per node and
reused by every image built on them, while unique layers are
fetched per image. A bloated final layer means every cold start
pays the fetch-and-unpack cost.

**How a container actually starts.** The OCI Runtime Specification
defines the contract between an orchestrator and a low-level
runtime (runc, crun). Starting a container means: create Linux
**namespaces** (PID, mount, network, UTS, IPC, user, cgroup) so
the process sees an isolated view of the kernel; apply **cgroup**
limits for CPU, memory, and PIDs; assemble the layered filesystem;
then exec the entrypoint. Namespaces provide the isolation
theater; cgroups provide the actual resource enforcement — this
distinction matters later when limits misbehave (§5). Because no
VM or guest OS boots, container startup is typically
hundreds-of-milliseconds-to-seconds versus minutes for a VM —
the single biggest operational advantage over the previous
generation.

**Multi-stage builds.** The standard pattern: a builder stage
carries the full toolchain and dependencies, compiles the
artifact, and a final stage copies only the runtime artifact into
a minimal base. The compiler, package manager, and build cache
never reach production — smaller image, smaller CVE surface,
faster pulls. Docker's multi-stage documentation is the canonical
reference.

**Minimal base images.** The spectrum: full distro (easy
debugging, huge attack surface) → slim → Alpine/musl (small, but
musl libc occasionally breaks binaries expecting glibc — prefer
static binaries when possible) → **distroless** (no shell, no
package manager, no package manager means no `apt`-installed CVEs
— you debug via ephemeral debug containers or logs, not `exec`)
→ **scratch** (empty base; only viable for fully static
binaries — Go and Rust services qualify naturally). Image size
compounds: smaller images mean faster pulls on new nodes, faster
scale-out, faster cold starts on serverless platforms, and fewer
packages to scan and patch.

**Reproducibility and supply chain.** Tags are mutable — `:latest`
or even `:1.2` can be repointed — so pin base images by **digest**
and record resolved digests in the lockfile of record. Deterministic
builds (fixed timestamps, sorted inputs) let you verify "same
source → same digest." Then the supply-chain stack: generate an
**SBOM** of what's inside, produce **build provenance**
(SLSA levels formalize the guarantees), **sign** images (Sigstore/
cosign) and **scan** for CVEs and misconfigurations at build time
(Trivy and similar) and again at admission time (policy engines
like Kyverno or OPA Gatekeeper, runtime detection with Falco).

**Runtime hardening defaults.** Every production image should
already encode: non-root `USER`, read-only root filesystem where
possible, `cap_drop ALL` + `no-new-privileges`, and minimal
Linux capabilities. Kubernetes' **Pod Security Standards**
(privileged/baseline/restricted) enforce the same ideas at
admission — treat "restricted" as the default posture and
justify anything looser.

### 2. Orchestration

Orchestration is a **desired-state reconciliation engine**. You
declare "I want N copies of this workload with these properties"
and controllers continuously drive actual state toward it. That
single idea generates everything else.

**Kubernetes, mechanically.** The control plane: the **API
server** is the stateless front door — every read and write goes
through it and state persists in **etcd**, a consistent
key-value store replicated via Raft. The **scheduler** watches
for unschedulable pods and assigns them to nodes by resource
requests, affinities, and taints. The **controller manager** runs
the reconciliation loops — Deployment, ReplicaSet, Endpoint,
Node, and dozens more controllers — that are the actual
self-healing engine: a node dies, the ReplicaSet controller
notices desired ≠ actual and creates replacements elsewhere. The
data plane: **kubelet** on each node pulls images (via the
Container Runtime Interface into containerd), starts pods, and
enforces the cgroup limits from §1; **kube-proxy** programs
service routing (iptables, IPVS, or eBPF); **CoreDNS** and CNI
plugins handle names and networking. The **pod** is the smallest
schedulable unit — a group of containers sharing a network
namespace and volumes.

**When Kubernetes earns its complexity.** K8s pays off when you
have many services × many replicas and need its primitives:
self-healing, rolling deploys, horizontal autoscaling, service
discovery, multi-AZ placement, mixed workload types. It costs:
etcd operations and backups, control-plane upgrades on a
cadence, CNI/network debugging, cluster autoscaling, and real
platform expertise — a team without a platform function
typically cannot run it well. Managed offerings (EKS, GKE, AKS)
remove the control-plane burden but you still own manifests,
networking, node upgrades, and cost allocation.

**The simpler end of the spectrum:**

- **Single host / small fleets:** systemd units or Docker
  Compose on a VM — right for one box, dev environments, or a
  genuinely tiny deployment. You give up self-healing across
  machines.
- **VM fleets + config management:** Ansible/Packer-style —
  full control, you own patching, rolling restarts, and
  everything else. Fine at modest scale; scaling it past a
  handful of services gets painful fast.
- **Managed container platforms:** AWS ECS abstracts the
  control plane entirely — you register tasks/services and
  choose capacity: EC2 (you manage nodes), **Fargate** (serverless
  containers — no nodes at all, pay per task-second), or
  ECS-on-prem via ECS Anywhere. Azure Container Apps and
  **Google Cloud Run** go further: push a container, get an
  HTTPS endpoint with automatic scaling **to zero**, per-request
  billing, revisions, and built-in traffic splitting — the
  serverless-container model applied to long-running services.
  Knative brings the same scale-to-zero/revision semantics to
  Kubernetes itself.
- **Nomad:** a single-binary orchestrator with a much smaller
  operational surface than K8s — Raft instead of etcd, a simpler
  job-spec model, and it schedules containers, VMs, and batch
  jobs uniformly. Weaker ecosystem and fewer managed offerings,
  but dramatically less to learn and operate.
- **PaaS:** Render, Railway, Fly.io Machines and friends — push
  code or an image, the platform owns everything. Least
  control, least ops, most vendor lock-in.

**The decision rule:** match operational weight to scale and
team. Start simpler; graduate to Kubernetes when you need its
primitives at scale _or_ when a platform team exists to run it.
Adopting K8s for three services with no platform team is the
classic expensive mistake — you inherit the complexity without
reaping the scale benefits.

### 3. CI/CD & delivery

**Build once, deploy many.** The artifact is the image digest —
built and tested once in CI, then _promoted_ through environments
as the same bits. Never rebuild per environment: a rebuild
produces a different artifact, so "what passed staging" is not
what runs in production. Environment differences are injected at
runtime as configuration (§4), not baked into the image. This is
the 12-factor "build, release, run" separation.

**Per-service pipelines.** Each service owns its pipeline — lint,
typecheck, unit tests, integration tests (ephemeral dependencies
via testcontainers or service containers), image build, scan,
sign, push by digest, auto-deploy to dev, gated promotion to
staging and production. In a monorepo, path-filtered/affected
pipelines give each service the same independence. The pipeline
must be fast enough that developers use it constantly — a
20-minute pipeline trains people to batch changes, which is how
drift starts.

**Progressive delivery.** The goal: deploy often while limiting
the blast radius of any single release.

- **Rolling update** (the Kubernetes default): replace pods
  gradually using `maxSurge`/`maxUnavailable`, gated by readiness
  probes. Simple and safe-ish, but no traffic shaping and no
  automated abort — a bad version rolls to 100% before metrics
  can react.
- **Blue-green:** two complete environments; switch traffic
  atomically. Instant rollback and zero mixed-version traffic —
  at the cost of double capacity during the switch and no
  gradual exposure to detect problems early.
- **Canary:** route a small percentage of real traffic to the
  new version, analyze metrics, then promote or roll back. This
  is where the machinery lives: tools like **Flagger** (a
  CNCF-graduated operator) and **Argo Rollouts** (a controller +
  CRDs) automate the loop — shift weight in steps (1% → 5% →
  25% → 50% → 100%), query metric providers (Prometheus is the
  common one; also Datadog, New Relic, Graphite, Kayenta-style
  analyses, or arbitrary webhooks) for signals like HTTP success
  rate, p99 latency, and custom business KPIs, hold for an
  analysis window, and **auto-rollback on threshold breach**.
  It requires traffic splitting at the service-mesh or ingress
  layer — canary is a routing capability, not just a pipeline
  stage.
- **Feature flags** decouple _deploy_ from _release_: ship dark
  or incomplete code behind flags, enable per-user or by
  percentage at runtime. They complement canaries (app-level vs.
  infrastructure-level rollout) and provide kill switches —
  OpenFeature has emerged as the vendor-neutral standard API.
  The cost is flag debt; every flag needs an owner and a
  removal plan.

**Automated rollback** works because Kubernetes retains old
ReplicaSets — rollback is "scale the previous version back up,"
not a redeploy. Two prerequisites make rollbacks actually safe:
**database migrations must be backward-compatible** (the
expand → migrate → contract pattern — old and new versions run
simultaneously during any rollout, so the schema must serve
both), and **contract tests** (consumer-driven contracts like
Pact) catch breaking API changes in CI before they reach a
cluster.

**What independent deployability requires:** each service owns
its schema and versions it deliberately; APIs change in
backward- and forward-compatible ways (or via explicit versioned
endpoints); no shared-database changes that force coordinated
deploys; observability good enough to detect regressions within
minutes; and a tested rollback path — an untested rollback is a
myth, not a capability.

The measurable outcomes are the **DORA four keys**: deployment
frequency, lead time for changes, change failure rate, and
failed-deployment recovery time. Progressive delivery exists to
move all four in the right direction at once.

### 4. Environments & configuration

**Environment parity.** The 12-factor principle: the same
artifact runs everywhere; only configuration varies. Containers
make this real — "works on my machine" becomes "the same image
runs everywhere," and differences collapse to environment
variables, mounted config, and attached backing services.

**Configuration as code.** Configuration belongs in Git,
reviewed like code: per-environment overlays (Kustomize-style)
for Kubernetes manifests, environment variables and mounted
files for application config, externalized secrets via an
operator (Vault, cloud secret managers, External Secrets) —
secrets management itself is ADR-008's scope; the boundary here
is simply "never secrets in Git, configmaps, or images."
Helm charts add templating power at the cost of abstraction
leakage — prefer plain manifests plus overlays until you
actually need Helm's dynamic features.

**GitOps.** The delivery model that makes environments
self-healing: desired state lives declaratively in Git; an agent
(**Argo CD**, **Flux**) continuously reconciles the cluster to
match it. Three properties follow mechanically: it's **pull-based**
(the agent polls or receives webhooks — CI never holds cluster
credentials, which solves the RBAC problem elegantly: developers
merge PRs, they don't `kubectl` prod); **auditable** (git log _is_
the deploy history; rollback is `git revert`); and it **detects
drift** (manual `kubectl` edits are flagged and corrected). The
OpenGitOps principles formalize this: declarative, versioned and
immutable, pulled automatically, continuously reconciled.

**Feature flags** (covered in §3) are the runtime half of
configuration: they let you change behavior without redeploying —
rollouts, kill switches, experiments, entitlement checks.

**The failure modes to design against:** staging that doesn't
match prod (different data scale, different dependency versions —
parity is a practice, not a checkbox); manual cluster edits
creating snowflake state (GitOps fixes this structurally); flag
proliferation (every flag needs an owner and expiry); and config
sprawl across repos (one config source of truth per environment).

### 5. Scaling & resource management

Scaling has two axes — **replica count** (horizontal) and **node
capacity** (the cluster itself) — and Kubernetes treats them as
separate control loops.

**Horizontal Pod Autoscaler (HPA).** A control loop in the
controller manager that reads metrics roughly every 15 seconds
and computes `desiredReplicas = ceil(currentReplicas ×
currentMetricValue / desiredMetricValue)`. The default metrics
pipeline: **metrics-server** scrapes cAdvisor on each node and
serves aggregated `metrics.k8s.io` CPU/memory utilization
(relative to each pod's _requests_). Custom metrics — queue
depth, Kafka consumer lag, request rate, business KPIs — come
via the Prometheus Adapter or, better for event-driven cases,
**KEDA** (Kubernetes Event-driven Autoscaler), which scales on
arbitrary external signals and can even scale to zero. HPA also
has **stabilization windows** — scale-up is aggressive,
scale-down deliberately slow (300-second default) — because
oscillation is worse than lag.

**Requests vs. limits — the cgroup contract.** This is where
containers get their actual resource behavior, and where the
classic production mysteries live:

- **Requests** are the scheduling reservation: the scheduler
  only places a pod where the sum of requests fits; under CPU
  contention, requests translate to CPU _shares_ (relative
  weight). HPA measures utilization _against requests_ — so
  requests are also your autoscaling baseline.
- **CPU limits** are enforced via CFS bandwidth quotas: a
  container exceeding its limit is **throttled** — the kernel
  pauses it for the remainder of each 100 ms accounting period.
  The failure signature is latency spikes with _low_ CPU
  utilization — a service can be simultaneously "under its CPU
  limit" in aggregate and stalling on throttling. Many teams
  now run CPU-unlimited (request-only) for latency-sensitive
  services and rely on requests + node capacity for fairness.
- **Memory limits** are different: exceed them and the kernel
  **OOM-kills** the container — a hard restart, not a throttle.
  Memory limits protect neighbors; leaving them unset risks one
  leaky pod killing the node.

Right-sizing is therefore an ongoing practice: **VPA**
(Vertical Pod Autoscaler) observes actual usage and recommends
or applies better requests; cost tools (Kubecost, OpenCost)
allocate spend per namespace/team so requests stop being free.

**Node-level scaling.** When pods can't be scheduled, two
autoscalers exist: the **Cluster Autoscaler** adds nodes when
pods sit unschedulable (it bin-packs first, then launches —
slow, minutes-scale); **Karpenter** watches for unschedulable
pods and provisions a right-sized node just-in-time, then
consolidates underutilized nodes — faster and cheaper, at the
cost of another component to run. Whichever you choose,
**PodDisruptionBudgets** and topology-spread constraints keep
replicas distributed across nodes and zones so node drains,
consolidation, and spot interruptions don't become outages.

**Scale-to-zero** (KEDA, Knative, Cloud Run-style platforms)
trades cold-start latency for near-zero idle cost — right for
spiky, delay-tolerant, or batch-ish workloads; wrong for
latency-sensitive services, which keep `minReplicas > 0`.

**Capacity planning.** Load-test to find the saturation knee —
the throughput at which p99 latency bends — then keep headroom
for node and AZ failure (N+1 at minimum). Watch the dependency
math: services scale horizontally faster than their databases,
connection pools, and downstream APIs do; the first bottleneck
is usually _not_ the service itself. For cost: right-size
requests relentlessly (every over-provisioned millicore is
recurring spend), use spot/preemptible capacity for
fault-tolerant workloads with PDBs, let consolidation reclaim
idle nodes, and remember the bill follows
`requests × replicas × time` — mis-sizing is a continuous
expense, not a one-time mistake.

**Bottom line:** packaging is about producing a minimal,
reproducible, signed artifact; orchestration is choosing how
much reconciliation machinery you actually need; delivery is
about promoting one tested artifact through environments with
bounded blast radius; configuration is keeping desired state in
Git; and scaling is two feedback loops — replicas via HPA, nodes
via cluster autoscaling — disciplined by honest requests,
limits, and budgets.

### Sources

- OCI & containers: [OCI Image Specification](https://github.com/opencontainers/image-spec);
  [OCI Runtime Specification](https://github.com/opencontainers/runtime-spec);
  [Docker — multi-stage builds](https://docs.docker.com/build/building/multi-stage/);
  [containerd documentation](https://containerd.io/docs/);
  [GoogleContainerTools/distroless](https://github.com/GoogleContainerTools/distroless)
- Supply chain & security: [SLSA — Supply-chain Levels for Software Artifacts](https://slsa.dev/);
  [Trivy documentation](https://aquasecurity.github.io/trivy/)
- Orchestration platforms: [Kubernetes — cluster components](https://kubernetes.io/docs/concepts/overview/components/);
  [Kubernetes — resource management for pods and containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/);
  [Kubernetes — Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/);
  [Nomad documentation](https://developer.hashicorp.com/nomad/docs);
  [AWS — Amazon ECS developer guide](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html);
  [Google Cloud — What is Cloud Run](https://cloud.google.com/run/docs/overview/what-is-cloud-run);
  [Knative documentation](https://knative.dev/docs/)
- CI/CD & delivery: [12factor.net](https://12factor.net/);
  [Flagger documentation](https://docs.flagger.app/);
  [Argo Rollouts documentation](https://argo-rollouts.readthedocs.io/);
  [OpenFeature](https://openfeature.dev/);
  [DORA — Accelerate](https://dora.dev/)
- Environments & GitOps: [OpenGitOps principles](https://opengitops.dev/);
  [Argo CD documentation](https://argo-cd.readthedocs.io/);
  [Flux documentation](https://fluxcd.io/)
- Scaling & resources: [Kubernetes — Horizontal Pod Autoscaling walkthrough](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/);
  [Kubernetes — resource metrics pipeline](https://kubernetes.io/docs/tasks/debug-application-cluster/resource-metrics-pipeline/);
  [kubernetes-sigs/metrics-server](https://github.com/kubernetes-sigs/metrics-server);
  [KEDA documentation](https://keda.sh/docs/);
  [Karpenter documentation](https://karpenter.sh/docs/)
