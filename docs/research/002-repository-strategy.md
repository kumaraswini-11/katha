# ADR-002: Repository Strategy — Monorepo vs. Polyrepo

## Status

Question approved — answer drafted (under review)

## The Question

Where should a system's code live — one repository or many — and
what tooling does each choice demand?

This is the general decision every team faces before writing code —
independent of any specific application.

1. **Monorepo vs. polyrepo.** When should all of a system's code
   live in a single repository, and when should it be split across
   many? Which factors legitimately drive the choice — team size
   and structure, shared code and contracts, release cadence,
   CI/build cost, dependency management, onboarding? What are the
   failure modes of each — monorepo scaling pain vs. polyrepo
   versioning and drift problems?

2. **Monorepo tooling.** If a monorepo is chosen, which build, test,
   and task-orchestration tooling fits — Turborepo, Nx, or other
   alternatives? What criteria decide between them — framework
   awareness, caching, affected detection, plugin ecosystems,
   learning curve? And when does a monorepo need an orchestrator at
   all, versus plain package-manager workspaces being sufficient?

3. **Polyrepo coordination.** If repositories are split, how are
   cross-repo versions, contracts, and releases managed — and what
   tooling exists to keep many repos consistent?

---

## Answer

### 1. Monorepo vs. polyrepo

A **monorepo** keeps all of a system's code — frontend, services,
libraries, infra — in one Git repository with one version history.
A **polyrepo** splits it into many repositories, one per
service/app/library.

**What each actually buys:**

- _Atomic cross-cutting changes._ In a monorepo, a breaking change
  to a shared contract and all its consumers update in **one
  commit**. In a polyrepo the same change is N pull requests across
  N repos, merged in dependency order — the "two-repo change"
  problem. This is the single biggest technical argument for
  monorepos when services share contracts.
- _Single source of truth for dependencies._ One lockfile, one
  version catalog — no "service A uses lib X@1.2, service B uses
  lib X@1.9" drift.
- _Unified tooling & CI._ One pipeline definition, shared build
  logic, shared lint/format/test config. In a polyrepo this is
  either duplicated (drift) or extracted into yet another repo
  (meta-repo problem).
- _Code discovery._ One `grep` finds every usage of a symbol.
  In a polyrepo you need code-search infrastructure (Sourcegraph,
  GitHub code search) to answer "who calls this?"

**What polyrepo buys:**

- _Repository-scale isolation._ Git itself degrades with repo size:
  clone/fetch times grow, `git log` slows, CI checkouts cost more.
  Large orgs hit this — which is why Google's monorepo needed
  bespoke tooling (Piper/CitCian, not plain Git).
- _Permission & access boundaries._ Different teams/repos can have
  different access controls — matters for open-source mixes,
  acquired codebases, or compliance segmentation.
- _Independent release trains._ A repo per service maps cleanly to
  "this team ships on its own schedule" — though monorepos achieve
  the same via path-filtered CI (see below).
- _Blast-radius containment._ A force-push or history rewrite in
  one repo can't touch others; branch protection is per-repo.

**The honest trade-off table:**

| Factor             | Monorepo wins when                                  | Polyrepo wins when                             |
| ------------------ | --------------------------------------------------- | ---------------------------------------------- |
| Shared code volume | Heavy — contracts, types, utilities used everywhere | Light — services genuinely independent         |
| Team size          | Small–medium (one org can see all code)             | Large orgs needing hard repo boundaries        |
| Release coupling   | Changes frequently span services                    | Services release on truly independent cadences |
| CI cost            | Mitigated by affected-detection + caching (see §2)  | Each repo CI is small, but duplicated          |
| Tooling maturity   | You adopt Nx/Turborepo/Rush                         | Plain per-repo CI suffices                     |

**The failure modes are symmetric:** monorepo without affected-
detection becomes "CI runs everything on every commit" — slow
feedback kills it. Polyrepo without contract discipline becomes
version drift and N-PR changes — coordination overhead kills it.

**Decision rule:** default to monorepo when code is tightly
coupled (shared contracts, shared types, frequent cross-cutting
changes) and the team is small enough to hold the whole system in
its head. Choose polyrepo when components are genuinely
independent — different languages, different lifecycles, hard
organizational boundaries — or when repo scale itself becomes the
problem.

### 2. Monorepo tooling

The reason monorepos need tooling at all: **a commit shouldn't
rebuild the world.** Three capabilities matter:

- **Task graph** — knows that `build web` depends on `build
shared-contracts` but not on `build billing-service`.
- **Affected detection** — given a diff, computes which projects
  could possibly be impacted (via the import/dependency graph) and
  runs only their tasks.
- **Caching** — hashes inputs (source files, deps, env) per task;
  identical inputs → replay outputs from cache instead of
  recomputing. This is where CI time actually comes from.

**The options:**

- **Nx** — the most batteries-included. Plugin architecture
  auto-detects frameworks (Next.js, NestJS, React libs get
  inferred `build`/`test`/`lint` targets without config), generates
  projects via `nx g`, computes the project graph for affected
  detection, caches locally _and_ distributes cache to CI/Nx
  Agents. Cost: heavier abstraction, more concepts to learn,
  opinionated structure. Best when you want framework-aware
  scaffolding + enterprise features out of the box.
- **Turborepo** — the lighter alternative. Pipeline-based: you
  declare task dependencies in `turbo.json`, it handles scheduling,
  caching, affected filtering, remote cache, and tag-based module
  boundary enforcement (`turbo boundaries`, introduced in v2.4+ as
  experimental). Works with any `package.json` scripts — no framework
  plugins, no code generation, and pairs cleanly with Biome without
  requiring ESLint. Cost: you wire up more yourself; less "batteries."
  Best when you want minimal magic, pure Biome, and already have
  working per-package scripts.
- **Rush** (Microsoft) — enterprise-grade pnpm-based orchestrator:
  phased builds (a change to a base lib triggers ordered rebuilds
  of dependents), repo governance via "rigs" (shared configs
  packaged as libraries), built-in versioning/publishing. Heavier
  ceremony; used at real enterprise scale.
- **Bazel / Pants / Buck2** — hermetic build systems: builds are
  reproducible because every action declares exact inputs. The
  most powerful correctness guarantees and the steepest learning
  curve — justified at Google-scale, overkill for most teams.
- **Moon** — newer Rust-based tool; fast task runner + toolchain
  management, simpler than Nx, less mature ecosystem.
- **Plain package-manager workspaces** (pnpm `-r`, npm/yarn
  workspaces) — `pnpm -r run build` runs the script everywhere.
  Zero orchestration, no caching, no affected detection — every
  commit builds everything. Correct choice only for small monorepos
  (a handful of packages) where "build everything" is fast enough.

**When does a monorepo need an orchestrator at all?** Rule of
thumb: when "run all tasks" exceeds your acceptable CI/dev-feedback
time — typically somewhere past ~10–20 packages, or the moment one
commit shouldn't rebuild unrelated apps. Below that, plain
workspaces suffice.

### 3. Polyrepo coordination

If you choose polyrepos, the coordination problems don't disappear
— they move into tooling:

- **Versioning & releases:** each repo versions independently
  (semantic-release, release-please, Changesets) or joins a
  release train. Cross-repo dependencies become _published
  artifacts_ — you consume service B's API via its published
  contract package, not its source.
- **Contract sync:** API/proto/event schemas live in registries —
  Confluent Schema Registry for Kafka Avro/Protobuf, `buf` for
  gRPC protos, GraphQL schema registries (Apollo, Hive
  Gateway). Breaking-change detection runs in CI
  (`buf breaking`, oasdiff for OpenAPI).
- **The "meta-repo" escape hatch:** some orgs keep a thin manifest
  repo listing all service repos + their pinned versions — gives
  one place to see "what's deployed where" without merging code.
- **What doesn't work well:** git submodules (notoriously painful
  UX), and "shared library repo" sprawl — every shared util becomes
  its own repo + version + publish pipeline.

**Bottom line:** monorepo vs. polyrepo is less about ideology and
more about _change coupling_. If most changes touch multiple
components at once → monorepo + affected-aware tooling. If
components change independently → polyrepo + contract registries.
The worst outcome is the accidental middle: many repos whose
changes are secretly coupled — you pay polyrepo coordination costs
_and_ still do N-repo changes.

### Sources

- Potvin & Levenberg, ["Why Google Stores Billions of Lines of Code in a Single Repository" (2016)](https://dl.acm.org/doi/10.1145/2854146)
- [Nx documentation](https://nx.dev/) · [Turborepo documentation](https://turborepo.dev/) · [RushStack](https://rushjs.io/)
- [pnpm workspaces](https://pnpm.io/workspaces) · [Lerna](https://github.com/lerna/lerna) · [Bazel](https://bazel.build/)
- [ThoughtWorks Technology Radar — monorepo/polyrepo assessments](https://www.thoughtworks.com/radar)
