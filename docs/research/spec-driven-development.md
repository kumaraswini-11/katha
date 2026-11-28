# Spec-Driven Development (SDD) — Research Brief

_A generic, project-agnostic survey of the spec-driven development methodology as it exists in late 2026: what it is, where it came from, the tools that implement it, where practitioners agree and disagree, and what a team should consider before adopting it._

> **Scope note.** This brief describes a methodology and ecosystem, not any particular codebase or team. All claims are sourced to public material; where evidence is thin or sources conflict, that is stated explicitly.

---

## 1. Executive summary

Spec-driven development (SDD) is the practice of making a written, structured **specification** the primary artifact of AI-assisted software development, with code treated as a derived output rather than the source of truth. The spec — usually Markdown files living in the repository — captures intent, behavior, acceptance criteria, constraints, and non-goals in a form both humans and LLM coding agents can read, review, diff, and version-control. The canonical contrast is with "vibe coding": prompt-and-pray sessions where intent lives only in ephemeral chat history and agents drift from what was asked.

The term is genuinely contested. The most useful analytical frame (Birgitta Böckeler, Thoughtworks, October 2025) distinguishes three levels of ambition that all travel under the name "SDD":

| Level              | What it means                                                                                                                                               | Status in the wild                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Spec-first**     | A spec is written before coding and drives the initial AI workflow; after the feature ships, the spec is scaffolding and may be discarded or left to drift. | Universal — every tool does this. Also called "documentation-first" or "spec-first development."                                           |
| **Spec-anchored**  | The spec persists after development as the living document for that feature's evolution and maintenance.                                                    | The contested "sweet spot." Most tools gesture at it; few enforce it. Spec drift is the unsolved problem.                                  |
| **Spec-as-source** | Humans maintain _only_ the spec; all code is generated and never hand-edited.                                                                               | Aspirational. Only Tessl explicitly targets it, and its framework remained in private beta through 2026 — evidence that the level is hard. |

**Bottom line up front:** the durable, broadly conceded insight is narrow but real — _agents perform measurably better against a reviewed, written statement of intent, and writing that spec is where the engineering thinking happens_. The heavyweight framework packaging around it (constitution → specify → plan → tasks → implement pipelines producing hundreds of lines of Markdown per feature) is where the controversy lives. Thoughtworks' Technology Radar assessed the technique in November 2025, dropped it in April 2026 as it fragmented into tools, and had moved one lightweight entrant (OpenSpec) to "Trial" by November 2026. Practitioners who tried the flagship tools report both genuine wins on large, ambiguous, multi-session work and serious friction — "a sea of markdown," double review burden, and specs that silently rot.

---

## 2. What SDD is: canonical definitions

The term is less than two years old in its current AI-era meaning, and no definition has won. The main formulations:

- **GitHub Spec Kit doctrine** (`spec-driven.md` in the `github/spec-kit` repo): SDD "inverts this power structure. Specifications don't serve code — code serves specifications." The PRD "isn't a guide for implementation; it's the source that generates implementation." The spec becomes "the primary artifact," and "the lingua franca of development moves to a higher level, and code is the last-mile approach." GitHub's own blog (Den Delimarsky, September 2, 2025) defines it more modestly: "you start with a spec. This is a contract for how your code should behave and becomes the source of truth your tools and AI agents use to generate, test, and validate code."
- **Tessl**: "A development approach where specs — not code — are the primary artifact. Specs describe intent in structured, testable language, and agents generate code to match them." (Quotations via Böckeler's survey.)
- **Birgitta Böckeler** (the most cited analytical definition, martinfowler.com, October 15, 2025): "Spec-driven development means writing a 'spec' before writing code with AI ('documentation first'). The spec becomes the source of truth for the human and the AI." She defines a _spec_ itself as "a structured, behavior-oriented artifact — or a set of related artifacts — written in natural language that expresses software functionality and serves as guidance to AI coding agents," and distinguishes specs (per-feature) from _memory bank_ files (cross-cutting context like `AGENTS.md`, architecture overviews, product docs).
- **Academic treatment**: the February 2026 arXiv survey "Spec-Driven Development: From Code to Contract in the Age of AI Coding Assistants" (Deepak Babu Piskala) formalizes the spectrum from code-first to fully spec-as-source, and cautions that "passing spec tests don't guarantee correct software — only that software matches the spec."
- **A deliberately dissenting voice**: Matt Pocock, whose widely used agent-skills toolkit (`mattpocock/skills`) includes a `/to-spec` command, publicly disputes the SDD label for his own approach. His specs are "a projection of the decisions made during grilling," intended to be _deleted_ after the work lands — spec-first handoff documentation, not a maintained source of truth. He argues it "needs its own term." This is a useful reminder that "spec" currently means everything from a throwaway ticket to a permanent contract.

**Practical definition used in this brief:** SDD = writing a versioned, reviewable specification before (and often alongside) implementation, and using that specification — not the chat transcript — as the durable statement of intent that humans and AI agents plan, implement, and verify against.

---

## 3. Origins and intellectual lineage

### 3.1 The term is older than the tooling

- **2004 — first published academic use.** Jonathan Ostroff, Richard Paige, and David Makalsky published "Agile Specification-Driven Development" at the XP 2004 conference (Springer LNCS), arguing that tests and contracts are both specifications at different granularities and can be intertwined with design and implementation. This is the earliest known published occurrence of "specification-driven development." The term then lived mainly in formal-methods and teaching circles for ~a decade.
- **Conceptual antecedents.** Tony Hoare's axiomatic program logic (1969) introduced pre/postconditions; Bertrand Meyer's Design by Contract (1986, Eiffel) made specifications executable inside the language; industrial formal methods (VDM, Z, B) proved specifications could be verified but proved too heavyweight for mainstream use — an early warning about specification overhead.
- **Practitioner lineage.** The current wave sits on decades of "make intent explicit" practice: Test-Driven Development (Kent Beck, ~2000), Behavior-Driven Development (Dan North, mid-2000s; Gherkin/Given-When-Then), Domain-Driven Design (Eric Evans, 2003), Specification by Example (Gojko Adzic, ~2011), and various modeling approaches (MDD/UML, EventStorming). One independent curator (specdriven.com, run by Sam Hatoum of Auto) claims the first _sustained industrial_ use of the phrase "spec-driven development" dates to his consulting work in 2016 — a self-interested but documented claim that should be read with that caveat.
- **AI-era catalysts.** Three events in 2025 turned the dormant term into a category:
  1. **Karpathy's "vibe coding"** (February 2025) named the problem SDD claims to solve — fluent but unverifiable agent output.
  2. **Sean Grove's "The New Code"** (AI Engineer World's Fair, June 2025; OpenAI) argued that code is a lossy projection of intent and that the scarce professional skill is structured communication of intent — using OpenAI's Model Spec as the exemplar of a living natural-language artifact. This talk is widely cited as the intellectual spark of the movement.
  3. **GitHub's Spec Kit** (public launch September 2, 2025) and **AWS Kiro** (preview July 14, 2025) gave the idea concrete, branded implementations.

### 3.2 The GitHub / Dohmke question

The popular framing attributes SDD to "GitHub's Thomas Dohmke," and there is real substance to it — but the precise claim needs unpacking:

- Dohmke did not coin the term and did not publish a canonical SDD definition. What he _did_ champion publicly was the underlying workflow. **GitHub Copilot Workspace** (announced April 29, 2024; technical preview expanded December 2024) embodied a spec→plan→implement agent pipeline: brainstorm the idea, produce a reviewable natural-language specification/plan, then implement. In his November 19, 2024 LinkedIn post on Copilot Workspace leaving preview, Dohmke described it as deploying "five agents: Brainstorm. Spec. Plan. Implement. Build/Repair." In interviews through 2024–2025 (Sequoia, August 2024; No Priors, March 2025; MAD Podcast, June 2025) he repeatedly described the pattern of having the agent first write a Markdown spec, then feed tasks into agent mode.
- The **named practice** "spec-driven development" was codified by GitHub in September 2025 — after Dohmke's August 2025 departure — via Den Delimarsky's blog post and the `spec-kit` repository's `spec-driven.md` doctrine document. Dohmke's post-GitHub venture, **Entire** (announced February 2026), doubles down on the same bet: he argues software development is moving "to a much higher abstraction, which is specifications — reasoning, session logs, intent, outcomes."

**Honest assessment:** Dohmke and GitHub deserve credit for _popularizing the spec-first agent workflow_ (Copilot Workspace, then Spec Kit), but "spec-driven development" as a named methodology is a collective coinage — academic roots in 2004, practitioner usage through the 2010s, Grove's 2025 essay, and simultaneous commercialization by GitHub, AWS, and Tessl. No single authoritative coiner is verifiable.

### 3.3 Why now: the enabling conditions

GitHub's own doctrine document lists three enabling trends, and they are broadly echoed elsewhere: (1) LLMs became capable enough that natural-language specs can reliably generate working code; (2) software complexity makes manual spec↔code alignment impractical, while agents can regenerate code cheaply and repeatedly; (3) specifications became cheap to produce, review, and diff — the Markdown-in-git format means specs participate in normal code review, branching, and history for the first time at scale.

---

## 4. The tool landscape

As of late 2026, "SDD tool" covers a spectrum from full opinionated pipelines to lightweight skills to built-in IDE features. The independent tracker **SDD Observatory** (sddobservatory.com) catalogs ~23 frameworks; the table below covers the significant ones. Star counts fluctuate; figures are approximate snapshots.

### 4.1 Comparison table

| Tool                    | Vendor / origin                                               | Model                                                                                                   | Core artifacts                                                                                                          | Claimed SDD level                               | Maturity signal                                                                       | Main criticism                                                                             |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **GitHub Spec Kit**     | GitHub (OSS, MIT)                                             | Agent-agnostic CLI + slash-command/skills workflow for 30+ coding agents                                | `constitution` + per-feature `spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model.md`, `contracts/`, checklists | Spec-first (rhetoric leans spec-anchored)       | ~150k★, de-facto reference implementation                                             | Heavyweight; verbose output; spec maintenance strategy left to teams                       |
| **AWS Kiro**            | AWS                                                           | Commercial agentic IDE (VS Code fork) + CLI + Web                                                       | `requirements.md` → `design.md` → `tasks.md` per feature; steering files (`product.md`, `tech.md`, `structure.md`)      | Spec-first; light anchoring                     | Public preview July 2025; GA-ish by 2026                                              | Same workflow for bug fix and greenfield; documented spec drift; early pricing controversy |
| **OpenSpec**            | Fission-AI (OSS, MIT)                                         | Agent-agnostic CLI; change-folder workflow                                                              | `proposal.md`, `design.md`, `tasks.md`, delta `specs/` per change; archive merges deltas into living specs              | Spec-anchored (deltas against persistent spec)  | ~75k★, Thoughtworks Radar "Trial" (Nov 2026)                                          | Less rigor for complex designs; younger ecosystem                                          |
| **Tessl**               | Tessl (Guy Podjarny, ex-Snyk; $125M raised Nov 2024)          | Spec-centric platform; Framework CLI doubles as MCP server                                              | Specs with `@generate`/`@test` tags; generated code marked "DO NOT EDIT"; Spec Registry (spec packages for libraries)   | **Spec-as-source** (the only explicit claimant) | Framework still private/beta through 2026; commercial energy moved to registry/skills | Unproven; closed beta for ~a year+ is itself evidence the level is hard                    |
| **BMAD-METHOD**         | BMad Code (OSS)                                               | Multi-agent persona pipeline (Analyst, PM, Architect, Dev, QA…)                                         | PRD, architecture, stories, ADRs, agent-specific context files                                                          | Spec-first→anchored                             | ~55k★, very active                                                                    | Far too heavy for routine work (its own "BMAD Quick" flow concedes this)                   |
| **Matt Pocock skills**  | Community (Matt Pocock)                                       | Small composable agent skills (`/grill-me`, `/to-spec`, `/to-tickets`, `/implement`, `/implement-spec`) | Conversation → spec issue → tickets; **specs are disposable handoff artifacts**                                         | Explicitly _not_ SDD (his framing)              | Popular among Claude Code/Codex users                                                 | Requires issue tracker + harness with subagents/worktrees; opinionated                     |
| **GSD (Get Shit Done)** | open-gsd community (originated gsd-build, Dec 2025)           | Context-engineering-first SDD loop; fresh-context subagents per phase                                   | Persistent state artifacts + phase-gated milestones                                                                     | Spec-first with heavy context discipline        | Rapid growth (~tens of thousands★ within months)                                      | New, fast-moving; complexity of its own orchestration                                      |
| **Agent OS**            | Builder Methods                                               | Standards-extraction: mines your codebase's real conventions and injects them as agent context          | Convention/context artifacts, not full specs                                                                            | Adjacent — spec-_supporting_                    | ~5–6k★                                                                                | Complements rather than replaces spec workflows                                            |
| **Conductor**           | gemini-cli-extensions (OSS plugin)                            | Repo-native SDD plugin for agent parallelization                                                        | Spec/plan artifacts per task                                                                                            | Spec-first                                      | Emerging                                                                              | Early stage                                                                                |
| **cc-sdd**              | gotalab (OSS)                                                 | Minimal SDD harness packaged as Agent Skills for ~8 agents                                              | Spec → autonomous long-running implementation with per-task review                                                      | Spec-anchored aspirations                       | Emerging                                                                              | New; thin track record                                                                     |
| **Built-in plan modes** | Claude Code, Cursor, Codex, Gemini CLI, Windsurf, Antigravity | Plan mode: read-only analysis → reviewable plan → implement                                             | Ephemeral plan + optional short spec                                                                                    | Spec-first, minimal persistence                 | **Mainstream absorption** — the biggest 2026 trend                                    | No durable spec; drift risk returns on iteration                                           |

Also tracked but earlier-stage or niche: AWS AI-DLC Workflows 2.0, Augment Cosmos/Intent, AI Unified Process (AIUP), SPARC, Taskmaster, Drydock, Superpowers, and various "spec management" layers (e.g., Pre.dev) that decouple spec authoring from agent execution.

### 4.2 GitHub Spec Kit — the reference implementation

Launched September 2, 2025 (blog: "Spec-driven development with AI: Get started with a new open source toolkit," Den Delimarsky), Spec Kit is an MIT-licensed Python CLI (`uv tool install specify-cli`) that scaffolds an agent-integrated workflow into a repo. Its distinguishing artifact is the **constitution** — a project-level document of "non-negotiable" principles evaluated on every change, effectively a very powerful rules file the whole pipeline consults.

The canonical command pipeline (agent skills, not shell commands):

```text
/speckit.constitution → /speckit.specify → /speckit.clarify → /speckit.plan
  → /speckit.checklist → /speckit.tasks → /speckit.analyze → /speckit.implement
  → /speckit.converge
```

- `constitution` — establish/update project principles (once per project)
- `specify` — produce `spec.md` from a natural-language feature description: user stories, requirements, acceptance scenarios; deliberately _what/why_, not tech stack
- `clarify` — optional quality gate: agent asks targeted questions about underspecified areas and folds answers back into the spec
- `plan` — generate technical design artifacts (`plan.md`, `research.md`, `data-model.md`, `contracts/`) where implementation detail belongs
- `checklist` — generate a requirements-quality checklist ("unit tests for your requirements") that a human reviewer signs off
- `tasks` — dependency-ordered `tasks.md` grouped by user story, with `[P]` parallel markers and exact file paths
- `analyze` — read-only cross-artifact consistency check across spec/plan/tasks
- `implement` — execute tasks in order (optionally per-phase)
- `converge` — verify the codebase against spec/plan/tasks and append gap tasks

Features live in per-feature directories under `specs/`; the active feature is tracked in `.specify/feature.json`. The quickstart explicitly documents **two paths** — a "shorter path" (specify→plan→tasks→implement→converge) for small features and a "full path" with clarify/checklist/analyze gates "for production features" — an implicit admission that one-size-fits-all ceremony doesn't fit. Spec Kit also documents three post-build spec-maintenance strategies (immutable historical record / living contract / reconcile full artifact set) and leaves the choice to each team. Its integrations cover 30+ agents including GitHub Copilot, Claude Code, Codex CLI, Gemini CLI, Cursor, Qwen, and Google Antigravity; `--integration none` supports agent-neutral teams.

### 4.3 AWS Kiro — the productized IDE

Kiro (preview launched July 14, 2025; built by a small AWS team led by Deepak Singh and Nikhil Swaminathan, on a Code-OSS/VS Code base) packages SDD as a guided IDE workflow rather than a portable toolkit:

- **Three-phase spec**: `requirements.md` (user stories in "As a…" format with acceptance criteria — notably in **EARS notation**, the aerospace-derived requirements syntax; The Register reported AWS staff describing "aerospace-grade" EARS criteria) → `design.md` (architecture, data flow, sequence diagrams, generated with repo context) → `tasks.md` (trackable implementation tasks with per-task run/review UI).
- **Spec types**: Feature Specs, Bugfix Specs (with `bugfix.md` capturing current/expected/unchanged behavior), and Quick Spec.
- **Steering files** — the "memory bank" layer: `.kiro/steering/` workspace files plus `~/.kiro/steering/` global files; generated foundation files `product.md` (purpose/users/goals), `tech.md` (stack/constraints), `structure.md` (layout/conventions). Workspace overrides global; `AGENTS.md` is also supported.
- **Human gates**: the user reviews and approves each phase before the next; tasks can be run individually or all at once; "hooks" provide event-driven automations.
- **Differentiator vs Spec Kit**: Kiro is opinionated and vertically integrated (one workflow inside one IDE) whereas Spec Kit is a portable process layer across agents. Böckeler's critique applies doubly: the same heavyweight ceremony is applied to a one-line bug fix, and the three files do not automatically stay in sync with the code — **spec drift is Kiro's documented Achilles' heel**, with practitioners reporting requirements/design docs contradicting shipped behavior within weeks.
- **Adoption friction**: the July 2025 preview was followed within a week by usage caps and a waitlist, then opaque credit-based pricing ("a wallet-wrecking tragedy," per The Register); pricing stabilized through 2026 tiers (Free/Pro/Pro+/Power). Treat pricing history as a cautionary tale about SDD tooling economics generally.

### 4.4 OpenSpec — the lightweight, brownfield-first counter-thesis

OpenSpec (Fission-AI/OpenSpec, created August 2025, openspec.dev) explicitly positions against Spec Kit's ceremony: "fluid, iterative, and explicitly built for brownfield codebases, not just greenfield." Its model:

- **Delta specs**: each change lives in `openspec/changes/<name>/` containing `proposal.md` (why/what changes), `design.md`, `tasks.md`, and a `specs/` folder of requirement deltas in plain Markdown using `ADDED`/`MODIFIED`/`REMOVED Requirements` sections with `WHEN…THEN` scenarios — no special syntax.
- **Change lifecycle**: explore (thinking mode, no code) → propose (agent drafts the change folder) → review (human corrects the plan _before_ code exists) → apply (implement task by task) → archive (deltas merge into the persistent source-of-truth specs).
- The archive step is a genuine attempt at **spec-anchored** development: the living spec accumulates what actually shipped, so the next change builds on current truth rather than a stale snapshot.
- CLI (`openspec init/list/show/validate/archive/new/status/instructions/templates/schemas`) plus agent skills for Claude Code, Cursor, Codex, Gemini CLI and others; no API key or MCP required.
- Independent hands-on comparisons (e.g., ranthebuilder's three-way test of BMAD, Spec Kit, and OpenSpec) scored OpenSpec highest for "lowest-friction start" and iterative work, at the cost of less rigor on genuinely complex designs. Thoughtworks moved it to Radar "Trial" in November 2026 after teams reported good results — while noting the persistent spec "still requires discipline" to keep current.

### 4.5 Tessl — the spec-as-source maximalist

Tessl (founded by Guy Podjarny, creator of Snyk; $125M raised November 2024 across seed + Series A) is the only vendor explicitly targeting spec-as-source: specs are "the primary artifact," generated code carries "GENERATED FROM SPEC — DO NOT EDIT" markers, specs map to code via `@generate`/`@test` tags, and `tessl build` regenerates code from spec. Their argument: specs act as durable, machine-readable "long-term memory" for product intent, and generating tests from spec examples creates regression guardrails. Two operating modes are described: spec-first (spec hardened and reviewed before generation, TDD-like) and a more exploratory mode.

The instructive part is the market signal: the Tessl Framework stayed in private/closed beta for roughly a year-plus while the company's commercial energy shifted to the **Spec Registry** (launched open beta September 2025, "npm for knowledge" — versioned spec packages describing how to use external libraries so agents stop hallucinating APIs; pivoted/expanded into a skills registry in January 2026). Böckeler judged Tessl "the most intellectually honest about which level it targets, and the least proven." Spec-as-source remains an open research problem, not a shipped practice.

### 4.6 Matt Pocock's skills — the dissenting minimalism

`mattpocock/skills` ("Skills for Real Engineers") is explicitly _not_ an SDD framework, and its author says so: his `/to-spec` "turns the conversation you have just had into a spec, and publishes it to your issue tracker," but the spec "does not interview you… does not validate or decide anything. It records what you decided." Its purpose is narrow and pragmatic: **context windows end, so multi-session work needs a durable home outside the context** — the spec is that home, made of user stories, implementation decisions, and a ticket list with blocking edges, consumed by `/implement` and `/implement-spec` (which fans tickets out to subagents in git worktrees). Related skills (`grill-with-docs`, `to-tickets`, `tdd`, `code-review`) encode Pocock's process: align first ("grill" the idea against the codebase), then execute in small verified slices. This is closer to disciplined spec-first + strong tests than to SDD-as-source — and it is arguably the most influential practitioner counter-model to the framework vendors.

### 4.7 The rest of the field (brief)

- **BMAD-METHOD** (~55k★): the maximalist — simulates a full agile team with 12+ agent personas producing PRD → architecture → stories → code. Praised for elicitation depth and adversarial review on complex features; criticized as ceremony-heavy for routine work.
- **GSD**: context-engineering-first loop spawning fresh-context subagents; its rapid rise suggests practitioners see _context management_, not spec volume, as the binding constraint.
- **Agent OS** (Builder Methods): mines existing codebase conventions and injects them as context — spec-_supporting_ infrastructure rather than a spec workflow.
- **Built-in plan modes** (Claude Code plan mode, Cursor Plan Mode, etc.): the 2026 absorption story — a read-only analysis → reviewable plan → implement loop plus a short markdown spec is now the de-facto lightweight spec-first workflow _without any framework_.
- Also tracked by SDD Observatory: AWS AI-DLC, Augment Cosmos/Intent, AIUP, SPARC, Taskmaster, Drydock, Superpowers, cc-sdd, Conductor, and spec-management layers like Pre.dev. The ecosystem is fragmenting faster than it is consolidating — a sign the methodology is still being negotiated.

---

## 5. Anatomy of the practice: workflow, artifacts, formats

### 5.1 The canonical pipeline

Despite surface differences, nearly every framework converges on the same skeleton (Böckeler's synthesis, confirmed by the tools' own docs):

```text
constitution/memory-bank → specify (what & why) → clarify (resolve ambiguity)
  → plan (tech stack, architecture, data) → checklist (requirements quality gate)
  → tasks (dependency-ordered breakdown) → analyze (cross-artifact consistency)
  → implement → converge/verify (code vs spec)
```

with **human review gates at each phase boundary**. The GitHub blog is explicit that the human role is "not just to steer. It's to verify."

### 5.2 Two layers of persistent context

Böckeler's most useful conceptual contribution is separating:

- **Memory bank** — cross-cutting context relevant to _every_ AI session in a codebase: product overviews, tech stack, structure/conventions, architecture principles, governance rules. (Spec Kit's `constitution`, Kiro's steering files, AGENTS.md/CLAUDE.md files all live here.)
- **Specs** — per-feature artifacts relevant only to the work that creates or changes that functionality.

Conflating the two is a common failure: project-wide rules baked into every feature spec create noise; feature details leaking into global rules create stale contradictions.

### 5.3 What a spec contains (convergent practice)

Across Spec Kit templates, Kiro outputs, OpenSpec deltas, and practitioner guides, a well-formed spec typically includes:

- **Problem/intent** — the _why_, from the user's perspective (PRD-style)
- **User stories / requirements** — "As a… I want… so that…" format
- **Acceptance criteria / scenarios** — the testable core; formats below
- **Non-goals and open questions** — explicit scope boundaries; an answered open question becomes a rule
- **Constraints & non-functional requirements** — performance, security, compliance, platform limits
- **Edge cases & error behavior** — where agents most often guess wrong
- **(In the plan layer)** technical design: data models, API contracts, component boundaries, migration/rollout notes

### 5.4 Acceptance criteria formats

- **EARS** (Easy Approach to Requirements Syntax; Mavin, Wilkinson, Harwood & Novak, Rolls-Royce, RE 2009): five constrained-natural-language templates — ubiquitous ("The system shall…"), event-driven ("WHEN… the system shall…"), state-driven ("WHILE…"), unwanted behavior ("IF… THEN…"), optional feature ("WHERE…"). Developed for aerospace certification requirements; adopted by Kiro. Strength: unambiguous, testable-by-construction, low training overhead. Weakness: awkward for non-behavioral/NFR constraints and requirements with many preconditions.
- **Gherkin / Given-When-Then** (BDD lineage): scenario tables readable by non-engineers and executable by Cucumber-compatible tooling. Strength: stakeholder-legible, machine-executable. Weakness: can become verbose; scenario-vs-unit granularity debates persist.
- **Plain structured prose with checkboxes** (Spec Kit's default, OpenSpec's `WHEN…THEN` deltas): lowest barrier, weakest guarantee — precision depends entirely on author discipline.

The emerging consensus: the _highest-ROI content of any spec is machine-checkable acceptance criteria_ — "spec defines the contract, tests enforce the contract" is the synthesis position in the SDD-vs-TDD debate (§8).

### 5.5 Versioning and lifecycle

Specs live in the repo as Markdown — versioned, diffable, reviewable in PRs. That is the core practical difference from prompt engineering. Lifecycle patterns observed:

- **Per-feature directories** (Spec Kit `specs/<feature>/`, Kiro's spec folders, OpenSpec `changes/<name>/`) — each change gets its own artifact set.
- **Delta specs** (OpenSpec): document only what changes; archive step merges deltas into persistent specs — the cleanest spec-anchored mechanism currently shipping.
- **Immutable vs living** (Spec Kit's documented choice): treat shipped feature dirs as historical record, maintain them as living contracts, or reconcile the full artifact set — with the warning that the first option "takes no effort, so it is what happens by default" (Lockstep's observation, §7.3).
- **Spec review before code**: every serious workflow inserts a human checkpoint where the plan/spec is corrected _before_ implementation — OpenSpec calls this "you correct the plan"; Spec Kit's clarify/checklist/analyze gates serve the same purpose.

---

## 6. Best practices (what credible sources converge on)

Synthesis across GitHub/AWS/Tessl/OpenSpec docs, Böckeler's analysis, Lockstep's drift guidance, practitioner post-mortems, and the Matt Pocock school:

1. **Size the ceremony to the problem.** The single most repeated rule. Spec Kit itself ships a "shorter path" for small features; Böckeler, Zaninotto, Scott Logic, and Thoughtworks all report the same failure mode — full pipeline on a bug fix or small change produces 10× the review burden for no quality gain. Skip specs for: trivial changes, prototypes/spikes, obvious-cause bug fixes. Use them where a misread requirement is expensive: multi-team features, compliance-adjacent work, ambiguous domains, brownfield changes to shared contracts.
2. **Spec-first is the floor; decide your anchoring level explicitly.** Write the spec before code — that part is uncontroversial. Then _choose_: disposable scaffold (Pocock's model), maintained per-feature contract (OpenSpec delta model), or generated-artifact source (Tessl's unproven model). The failure mode is drifting into spec-first by accident and then wondering why next quarter's agent reads last quarter's assumptions.
3. **Put the thinking in the spec, not the ceremony.** The spec's value is forcing intent to be explicit _before_ tokens flow. Verbose boilerplate (imagined edge cases, decorative architecture prose) dilutes the signal the agent actually reads and inflates review cost. Several critics independently report agents ignoring or over-obeying instruction files — a shorter, sharper spec beats a longer, vaguer one.
4. **Human gates at phase boundaries — and actually hold them.** The workflow only works if someone reviews the spec/plan before implementation and the code after. Böckeler's "verify, don't just steer" (GitHub's own phrasing) and the double-review critique (§7) both point to the same truth: the spec review does not replace code review; budget for both or the process silently degrades.
5. **Write machine-checkable acceptance criteria.** EARS or Gherkin scenarios, ideally tied to real tests. The arXiv survey and practitioner consensus agree: intent-level contracts + executable verification is where SDD pays.
6. **Separate functional spec from technical plan — but don't pretend they're independent.** Spec Kit's specify/plan split and Böckeler's functional-vs-technical discussion both try to keep requirements technology-agnostic so specs survive stack changes. In practice the separation leaks (design constraints shape requirements); the pragmatic rule is: keep _intent and acceptance criteria_ stable and let _design details_ evolve, rather than enforcing a purity that real projects can't maintain.
7. **Version specs with code; review them in PRs.** Specs in git get branching, history, and code-review rigor for free. Spec changes should be as reviewable as code changes — including when they happen _in_ a PR (a behavior change decided in review is a spec change).
8. **Manage spec drift deliberately.** This is the field's #1 unsolved practical problem (§7.3). Lockstep's proposed discipline is the best current articulation: keep _rules_ (requirements, constraints, decisions) living with named owners and versioned changes; let _plans and task lists_ expire as historical record. An alternative emerging pattern: derive the durable artifact from tests/ADRs rather than maintaining parallel prose.
9. **Brownfield: start with a bounded slice.** Spec Kit's existing-projects guidance, OpenSpec's delta model, and Kiro's bugfix-spec type all converge: don't document the whole system up front; spec the next reviewable change against what the code already does.
10. **Expect the agent to disobey — design for it.** Böckeler documented agents ignoring research notes, duplicating existing classes, and over-applying constitution rules. Mitigations that recur: smaller work packages, analysis/consistency-check steps, tests as ground truth over prose, and treating spec non-compliance as a signal to simplify the spec rather than add more rules.

---

## 7. Criticisms and limits

The critical literature is unusually well-developed for a trend this new. The major strands:

### 7.1 "Waterfall rebranded"

The loudest charge, articulated most forcefully by **François Zaninotto (Marmelab, "Spec-Driven Development: The Waterfall Strikes Back," November 12, 2025 — ~330 points on Hacker News)**: SDD revives heavy documentation before coding, "burying agility under layers of Markdown." His hands-on test of Spec Kit, Kiro, Tessl, and BMAD catalogued seven failures: context blindness (agents miss existing code that needs updating), Markdown madness (developers spend the session "reading long Markdown files, hunting for basic mistakes"), systematic bureaucracy (repetitions, imaginary corner cases, over-engineered refinements), faux-agile user stories, **double review burden** (review the spec's embedded code _and_ the implementation), false sense of security (agents skip spec-mandated steps), and poor scaling on large existing codebases. His alternative — "Natural Language Development": identify the riskiest assumption, run the smallest experiment, iterate with short instructions — produced a working 3D tool in ~10 hours with no spec.

**Colin Eberhardt (Scott Logic, November 26, 2025)** ran a controlled-ish comparison rebuilding a hobby-app feature with Spec Kit: ~33.5 minutes of agent execution, ~2,577 lines of Markdown, versus ~8 minutes and ~1,000 LOC for his normal incremental approach — self-reported as "about ten times" slower end-to-end, with "the same bugs." His deeper argument: "Specification is the law" is flawed because Markdown specs lack the formality of code — you can test code, you can't prove a spec.

**The defense** (Roger Wong's "It Looks Like Waterfall (And I Feel Fine)"; scrum.org's counterpoint; the HN threads): waterfall's fatal flaw was months-long feedback loops; SDD's loops are minutes, scope is bounded per-feature, and specs are living diffable artifacts rather than signed-off tombstones. "Rapid iterative waterfall" is arguably a contradiction in terms. Both sides are partly right — the waterfall charge lands when ceremony is proportional to a small change, and misses when the spec is genuinely the review surface for ambiguous intent.

### 7.2 Volume, cost, and context economics

- **Token/context bloat**: one feature restates requirements across `spec.md`, `plan.md`, `tasks.md` — "one idea, paid for three times" (SimonDevs' critique). Worse, when context windows fill, compaction summarizes away detail — and "the original spec intent, the thing Spec Kit exists to preserve, is often the first casualty" (same source, argued persuasively).
- **Measured verbosity**: Marmelab counted 8 files / ~1,300 lines of Markdown for adding a date field (via Spec Kit) and comparable output from Kiro. Thoughtworks Radar Vol. 34 (April 2026) dropped the SDD _technique_ from the Radar and placed Spec Kit in Assess citing "overly verbose markdown outputs that increased cognitive load."
- **Process friction**: martuni.de's Spec Kit post-mortem cites forced branch-per-spec (breaking parallel spec work), no debug command ("debugging only possible by going around Spec-Kit"), and constitution rules living in hidden directories that stop applying exactly when needed.
- **Secondary-reported empirical note**: a study summarized by bootloader.live/crystalspec (ETH Zurich, 138 tasks across four agents) found LLM-generated context files _reduced_ success ~3% while raising cost ~20% — attributed to agents following instructions _too_ literally (running more tests, searching more files). Treat as a single study, directionally consistent with the "over-ceremony" critique.

### 7.3 Spec drift — the deepest problem

Lockstep's analysis ("Spec-driven development problems: the real one is drift," November 2026) argues the common complaints are about _writing_ specs, but the bigger cost arrives _after_ the first build: specs guide the initial generation and are never updated, so the next agent reads rules that are no longer true. Their examples are mundane and devastating — a link-expiry constant changed in code but not spec; a PR-added exception never written back; an open question answered in Slack but still listed as open. With human readers a stale spec is harmless ("people know it is old and ask someone"); **an agent treats it as current law and writes confident, consistent code against a product that no longer exists.** SDD makes specs more influential, which makes stale specs more expensive — drift is spec-anchored development's unsolved core, and spec-first's quiet default (ship it, forget it) is drift by another name. Böckeler notes even Tessl's anchoring ambitions leave "the spec maintenance strategy over time… vague or totally open."

### 7.4 Illusory control and the limits of prose

Böckeler's sharpest observations: agents "frequently ignored the elaborate instructions anyway" — duplicating existing classes because research notes were misread as new specs, or over-applying constitution articles. A spec improves the _odds_ of alignment, not the guarantee; and a reviewed-and-approved _wrong_ spec is still wrong, now with more institutional authority behind it. Kent Beck's February 2026 essay "Earn And Learn" supplies the structural version of this critique: spec-driven development assumes you're playing **The Finish Line Game** ("build X, you're done"), but most software is **The Compounding Game** ("the first thing we finish earns the resources for the next"), where a better spec "will never get you from dollar sign N to dollar sign N+1 forever" — sustaining a codebase requires ongoing judgment about futures (architecture, simplicity) that no up-front document captures.

### 7.5 Historical déjà vu and evidence quality

- Böckeler explicitly invokes **Model-Driven Development**'s failure — abstraction-awkwardness plus overhead — wondering whether LLMs produce "the worst of both" (rigid spec layer + non-deterministic generation). The SoftwareSeni lineage piece traces TDD→BDD→MDD→SDD as successive moves of the source of truth toward intent; whether SDD "terminates" that progression is asserted, not proven.
- **Empirical evidence is thin.** The arXiv survey itself flags that headline benefit figures (e.g., "~50% error reduction from human-refined specs," "75% API cycle time reduction") are self-reported or uncontrolled. The most rigorous small pilot found so far (Nitin Garg, InfoQ, September 2026, cited via re:cinq) cuts both ways: specs did **not** help reviewers find more defects (recall ~0.52 vs ~0.52), but made findings traceable to requirements (81% vs 0%) at ~2× review time; staged spec-then-generate helped _weaker_ models most (+22 points on a hard task) while a strong model gained ~2. Vendor adoption statistics (Spec Kit's ~150k stars, Mercari's reported 150% speed gain) measure enthusiasm and AI-code productivity generally, not spec efficacy specifically.
- **Semantic diffusion**: "spec-driven development" currently means everything from Pocock's disposable handoff note to Tessl's never-edit-code regime. Böckeler, the field-study survey, and the SDD Observatory all flag this as a barrier to evaluation — you cannot measure a practice whose definition is contested.

---

## 8. Relationship to adjacent practices

SDD does not replace earlier disciplines; it repositions them as inputs to and checks on the spec.

| Practice                                 | Relationship to SDD                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TDD**                                  | Complementary layers, not rivals. TDD assumes someone already decided _what_ to build; SDD is where that deciding happens. Consensus synthesis: **spec defines the contract at intent level; tests enforce it at implementation level.** Beck's position is that TDD matters _more_ with agents, not less. Some workflows (Tessl's spec-first mode, Pocock's `/implement` driving `/tdd` at agreed "seams") explicitly fuse them. |
| **BDD / Specification by Example**       | Direct ancestor. Gherkin scenarios are a spec acceptance-criteria format; "living documentation" is the spec-anchored ambition in different clothes. SDD's delta specs (OpenSpec) are structurally similar to Cucumber feature files organized by change.                                                                                                                                                                         |
| **ADRs (Architecture Decision Records)** | Complementary, different altitude. ADRs record _why a decision was made_ (durable, rarely changed); specs record _what the system should do_ (evolving). Pocock's `grill-with-docs` updates ADRs and glossary inline; mature SDD setups should treat ADRs as spec-adjacent memory-bank content, not duplicate them inside feature specs.                                                                                          |
| **PRDs / RFCs / design docs**            | A modern agent-facing spec is effectively a fused, leaner PRD+RFC: product intent (PRD) + technical approach (RFC/design doc) + acceptance criteria (test plan), optimized for machine consumption. The risk is format drift — agent specs that copy heavyweight PRD conventions inherit their review burden.                                                                                                                     |
| **Prompt engineering / context files**   | AGENTS.md/CLAUDE.md-style instruction files are the _memory bank_ layer beneath specs (Böckeler's distinction). SDD adds the per-feature layer on top. The ETH-Zurich-reported finding that bloated context files can _hurt_ agent performance applies doubly here.                                                                                                                                                               |
| **MDD / formal methods**                 | Historical ancestor and cautionary tale. Design-by-Contract and UML/MDD tried to make specs executable decades ago; they failed on tooling and abstraction friction. LLMs remove the generator bottleneck but add non-determinism — Böckeler's "worst of both" worry.                                                                                                                                                             |
| **Code review**                          | Not replaced — relocated. The spec becomes an additional review surface _before_ code exists; the "double review" critique is the price. Teams that can't afford two reviews should write smaller specs, not skip the spec review.                                                                                                                                                                                                |

---

## 9. Adoption considerations (generic)

What a team needs before adopting SDD, synthesized from the critical and practical literature:

**Decide the level first.** Spec-first (spec as disposable scaffold) is achievable with any tool and captures most of the near-term value. Spec-anchored requires a drift-management discipline and tooling that supports deltas or consolidation (OpenSpec's archive model is the clearest example). Spec-as-source is a research bet — do not plan production work around it in 2026.

**Define the spec lifecycle explicitly.** For every spec, answer: who writes it, who reviews it, what happens to it after merge (archive? maintain? delete?), who owns keeping rules current, and how spec changes get proposed (PR? issue? agent session?). "Left vague" is the documented default failure.

**Assign spec ownership.** Product rules need a product owner; technical constraints need an engineering owner (Lockstep's rule-owner model). Specs without owners drift within weeks — the Kiro practitioner quote is the canonical warning: "it just keeps drifting and drifting until you have duplication and contradictions."

**Choose ceremony per work size — in policy, not vibes.** Write down which change classes get which treatment: full pipeline for multi-team/ambiguous/compliance work; a short spec or plan-mode + tests for ordinary features; nothing for trivial fixes. Every negative report in the literature is a ceremony-mismatch report.

**Budget the real costs.** Expect: token spend on spec generation and re-reads (specs are paid for in context every session); review time roughly _added_ to code review, not substituted; tooling subscription or self-hosting overhead; and onboarding time for the spec format and gates. Spec Kit is free but Python-CLI + template maintenance is real work; Kiro/Tessl are commercial; BMAD/GSD/OpenSpec are free but carry their own complexity.

**Invest in spec-review skill, not just tooling.** The scarce skill is writing _good_ specs — tight intent, testable criteria, honest non-goals — and reviewing agent-generated ones skeptically. Teams weak at requirements elicitation will produce weak specs faster. Pocock's "grill" pattern (interrogate the idea against the codebase before writing anything) is one proven way to build that skill.

**Pilot before standardizing.** Run one bounded, medium-complexity feature through the full loop and measure: spec authoring time, review time (spec + code), rework/bug rate vs. baseline, and — critically — what happens to the spec in week 6. Böckeler's open questions and Thoughtworks' Assess→Trial→(tools) trajectory both suggest the honest answer is "it depends on your problem mix."

**When not to adopt (or adopt minimally):** solo/small teams doing mostly small changes; prototype-heavy work; codebases where the binding constraint is context rot rather than intent ambiguity; teams that cannot commit to spec maintenance — spec-first-only or plan-mode may capture the value without the drift debt.

---

## 10. Evidence gaps and open questions

- **No controlled studies of SDD vs. strong prompting + tests.** The best available data are self-reports, vendor metrics, and one small pilot. The field-study survey (July 2026) explicitly flags that quantitative evidence "is thin."
- **Spec drift has no shipped general solution.** Delta specs, consolidation passes, and rule-versioning are proposals; automated spec↔code consistency checking (Spec Kit's `analyze`/`converge` are partial) is the obvious frontier — arXiv's "Spec Growth Engine" (June 2026) proposes drift-_enforced_ architectures.
- **Does spec-anchored actually pay for its maintenance cost?** Unproven at scale. Tessl's pivot toward skills/registry and Spec Kit's "choose your own maintenance strategy" both suggest the market hasn't answered this.
- **Who is the spec for?** Böckeler's unresolved question — developer-authored specs assume developers do requirements analysis; PM-authored specs assume a review handoff. The tools are ambiguous about the target user, and the answer changes the whole workflow.
- **Multi-agent / parallel futures.** GSD's rise and Conductor-style parallel-agent tooling suggest specs may evolve from "document for one agent" into "coordination medium for agent fleets" — a use case the current generation of tools only half-supports.
- **The definition itself is unstable.** Expect consolidation, renaming, or absorption into built-in agent features (plan modes) through 2027; the standalone-framework window may be short.

---

## 11. Bottom-line assessment

Spec-driven development is best understood as **a real insight wrapped in an immature packaging**. The insight — that LLM agents need a durable, reviewable statement of intent and that writing one is itself the core engineering work — is well-supported by convergent practitioner experience and early (if thin) evidence, and it will likely persist in some form regardless of which tools survive. The packaging — heavyweight multi-phase pipelines emitting hundreds of lines of Markdown per change — has produced the field's loudest failures: waterfall cosplay, double review, token bloat, agent non-compliance, and spec drift.

The mature position emerging across Thoughtworks' Radar assessments, Böckeler's taxonomy, the critical post-mortems, and the lightweight entrants (OpenSpec, plan modes, Pocock-style skills) is: **spec-first, deliberately; spec-anchored where the contract matters and you can maintain it; spec-as-source as a watch item, not a plan.** Match ceremony to problem size, keep acceptance criteria machine-checkable, treat spec maintenance as a first-class cost, and review the spec like you review code — because increasingly, it _is_ the code's source.

---

## Sources

### Origins, definitions & commentary

- [Spec-driven development with AI: Get started with a new open source toolkit — GitHub Blog (Den Delimarsky, Sept 2025)](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)
- [Specification-Driven Development (SDD) — spec-kit doctrine doc](https://github.com/github/spec-kit/blob/main/spec-driven.md)
- [Understanding Spec-Driven-Development: Kiro, spec-kit, and Tessl — Birgitta Böckeler, martinfowler.com (Oct 2025; updated Sept 2026)](https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) · [author's updated version](https://birgitta.info/posts/spec-driven.html)
- [The New Code: Why Specifications Are Eating Programming — Sean Grove (June 2025)](https://www.riseos.com/blog/2025-06-15-the-new-code/) · [talk video, AI Engineer World's Fair 2025](https://www.youtube.com/watch?v=8rABwKRsec4)
- [Where "Spec-Driven Development" Came From — specdriven.com (Sam Hatoum; self-interested curator, claims 2016 industrial usage)](https://specdriven.com/origins)
- [Ostroff, Paige & Makalsky, "Agile Specification-Driven Development," XP 2004 — ResearchGate](https://www.researchgate.net/publication/221592745_Agile_Specification-Driven_Development)
- [Dohmke on Copilot Workspace's five agents (Brainstorm. Spec. Plan. Implement. Build/Repair) — LinkedIn, Nov 2024](https://www.linkedin.com/feed/update/urn:li:activity:7264656931728883714) · [Sequoia interview, Aug 2024](https://newsfilter.io/interviews/github-ceo-thomas-dohmke-on-building-copilot-and-the-the-future-of-software-2b2a056bd8d459179eedbd28e92c62ba) · [No Priors Ep. 106, Mar 2025](https://ulisten.ai/channels/no-priors/no-priors-ep-106-with-github-ceo-thomas-dohmke_XqvNnl2AJko/transcript) · [Entire launch coverage, The New Stack, Feb 2026](https://thenewstack.io/thomas-dohmke-interview-entire/)
- [Spec-Driven Development: From Code to Contract in the Age of AI Coding Assistants — arXiv:2602.00180 (Piskala, Feb 2026)](https://arxiv.org/html/2602.00180) · [Specification-Driven Development as the Foundation of AI-Native Enterprise Software Engineering — arXiv:2607.16680](https://arxiv.org/abs/2607.16680)
- [Earn _And_ Learn — Kent Beck (Feb 2026)](https://newsletter.kentbeck.com/p/earn-and-learn) · [summary](https://kentbeck.com/summaries/earn-and-learn/)
- [Spec-Driven Development (SDD) with AI Coding Agents — State of the Art, Mid-2026 — ianhxu/agentic-engineering-field-study](https://github.com/ianhxu/agentic-engineering-field-study/blob/main/04-spec-driven-development.md)

### Tools & platforms

- [github/spec-kit repository](https://github.com/github/spec-kit/) · [quickstart docs](https://github.com/github/spec-kit/blob/main/docs/quickstart.md) · [integrations](https://github.com/github/spec-kit/blob/main/docs/integrations/index.md)
- [Kiro docs: Specs](https://kiro.dev/docs/specs/) · [Steering](https://kiro.dev/docs/steering/) · [Introducing Kiro (July 2025)](https://kiro.dev/blog/introducing-kiro/) · [AWS launch coverage — CNBC](https://www.cnbc.com/2025/07/14/aws-launches-kiro-ai-coding-program.html) · [TechTarget](https://www.techtarget.com/news/AWS-Kiro-coding-agents-highlight-spec-driven-development/857725/) · [The Register (EARS detail)](https://www.theregister.com/software/2025/07/14/aws-previews-kiro-ide-for-devs-over-vibe-coding/983534)
- [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec/) · [openspec.dev docs](https://openspec.dev/docs/quickstart) · [CLI reference](https://openspec.dev/docs/cli)
- [Tessl: How Tessl's Products Pioneer Spec-Driven Development](https://tessl.io/blog/how-tessls-products-pioneer-spec-driven-development) · [From Code-Centric to Spec-Centric](https://tessl.io/blog/from-code-centric-to-spec-centric) · [Series A announcement (Nov 2024)](https://tessl.io/blog/announcing-our-series-a-for-ai-native-software-development) · [TechCrunch](https://techcrunch.com/2024/11/14/tessl-raises-125m-at-at-500m-valuation-to-build-ai-that-writes-and-maintains-code/)
- [mattpocock/skills](https://github.com/mattpocock/skills/) · [to-spec docs](https://github.com/mattpocock/skills/blob/main/docs/engineering/to-spec.md) · [engineering skills README](https://github.com/mattpocock/skills/blob/main/skills/engineering/README.md) · [Spec.md in dictionary-of-ai-coding](https://github.com/mattpocock/dictionary-of-ai-coding/blob/main/dictionary/Spec.md) · [5 Agent Skills I Use Every Day — aihero.dev](https://www.aihero.dev/5-agent-skills-i-use-every-day)
- [SDD Observatory — framework tracker](https://sddobservatory.com/frameworks/) · [comparison matrix](https://sddobservatory.com/compare/)
- [Spec Kit vs Kiro vs OpenSpec vs BMAD — comparison overview (Medium, Oct 2025)](https://medium.com/@tim_wang/spec-kit-bmad-and-agent-os-e8536f6bf8a4)

### Critiques, evidence & practice

- [Spec-Driven Development: The Waterfall Strikes Back — François Zaninotto, Marmelab (Nov 2025)](https://marmelab.com/blog/2025/11/12/spec-driven-development-waterfall-strikes-back.html) · [HN discussion](https://news.ycombinator.com/item?id=45935763)
- [Putting Spec Kit Through Its Paces — Colin Eberhardt, Scott Logic (Nov 2025)](https://blog.scottlogic.com/2025/11/26/putting-spec-kit-through-its-paces-radical-idea-or-reinvented-waterfall.html)
- [The inefficiencies of Spec Kit — SimonDevs](https://simondevs.com/blog/the-inefficiencies-of-speckit/) · [Spec-Kit in General and in Cursor in Particular — martuni.de](https://martuni.de/en/posts/speckit)
- [Spec-driven development problems: the real one is drift — Lockstep (Nov 2026)](https://www.getlockstep.dev/blog/spec-driven-development-problems)
- [We Tried Spec-Driven Development So You Don't Have To — Attila Vágó, Prezi Engineering (Feb 2026)](https://medium.com/prezi-engineering/we-tried-spec-driven-development-so-you-dont-have-to-56d52231c19e)
- [Thoughtworks Technology Radar — Spec-driven development technique (Assess, Vol. 33, Nov 2025)](https://thoughtworks.com/radar/techniques/spec-driven-development) · [Radar movement summary — Interlusion](https://interlusion.dev/en/blog/spec-driven-development-a-map-of-the-field/)
- [It Looks Like Waterfall (And I Feel Fine) — Roger Wong (2026)](https://rogerwong.me/2026/03/spec-driven-development) · [SDD isn't waterfall — unless you're using it that way — scrum.org](https://www.scrum.org/resources/blog/spec-driven-development-isnt-waterfall-unless-youre-using-it-way) · [Spec-driven development is dead, long live plan mode — Instil](https://instil.co/blog/spec-driven-development-is-dead-long-live-plan-mode)
- [Spec-driven development with AI for enterprises — Pluralsight (Jun 2026)](https://www.pluralsight.com/resources/blog/software-development/spec-driven-development-with-AI-SDD) · [What Is Spec-Driven Development? — re:cinq (incl. InfoQ pilot summary)](https://re-cinq.com/topics/spec-driven-development)
- [Spec-Driven Agentic Development — A Lifecycle Analysis — bootloader.live (Mar 2026)](https://bootloader.live/posts/spec-driven-agentic-dev/) · [Your agent isn't guessing — crystalspec.com](https://crystalspec.com/blog/your-agent-is-guessing)

### Requirements notation & lineage

- [EARS — Easy Approach to Requirements Syntax (Mavin et al., RE 2009); author's site](https://alistairmavin.com/ears/) · [IEEE paper](https://doi.org/10.1109/re.2009.9) · [Wikipedia](https://en.wikipedia.org/wiki/Easy_Approach_to_Requirements_Syntax)
- [A Sufficiently Detailed Spec Is Code — SoftwareSeni (lineage: TDD→BDD→MDD→SDD)](https://www.softwareseni.com/a-sufficiently-detailed-spec-is-code-the-community-principle-behind-spec-driven-development/)

_Unverified or single-source claims flagged in text: Sam Hatoum's 2016 "first industrial use" claim (self-interested); the ETH Zurich context-file study figures (secondary reporting); specific 2026 star counts (rapidly changing); Tessl Framework's private-beta status (as of mid/late 2026 reporting)._
