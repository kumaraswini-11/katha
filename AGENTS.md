# AGENTS.md — Katha Engineering Rules

Katha is an enterprise-grade, microservices-based real-time workspace chat monorepo built **one deployable at a time**.

## Commands

```bash
pnpm install                  # Install workspace dependencies (strict catalog + 7-day release age)
pnpm lint                     # Biome check (lint, format, import sorting, Tailwind class sorting)
pnpm lint:fix                 # Auto-fix formatting, lint, and import order
pnpm ci:lint                  # Read-only Biome CI verification
pnpm boundaries               # Turborepo architectural boundary verification
pnpm check-types              # TypeScript 7 typecheck across workspace
pnpm build                    # Build compiled packages and services
pnpm test                     # Run Vitest unit/integration tests
```

## Non-Negotiable Architecture Rules

1. **One deployable at a time.** Never scaffold future services or infrastructure before their roadmap step.
2. **Strict package boundaries (`turbo.json`).**
   - `services/*` (`service`) must never import from other `services/*` or `apps/*`. Cross-service communication happens strictly over HTTP, gRPC, or Kafka.
   - `apps/*` (`app`) must never import from `services/*`.
   - `packages/contracts` (`contracts`) stays a pure Zod schema/types leaf package.
3. **Database-per-service.** Each service owns its schema and least-privilege DB credentials; never query across service schemas.
4. **Toolchain & Versions:**
   - **Editor-agnostic:** Rely on `biome.json`, `.editorconfig`, and `tsconfig.json`—never commit `.vscode/` or `.idea/`.
   - **TypeScript 7 (`7.x`):** Never use removed options (`baseUrl`, `outFile`, `downlevelIteration`, `moduleResolution: "node"`). Keep `"erasableSyntaxOnly": true` and explicit `"rootDir"` / `"types"`.
   - **Pure Biome:** Never introduce ESLint or Prettier. Import sorting and Tailwind CSS v4 class sorting (`useTailwindSortedClasses`) live in `biome.json`.
   - **pnpm Catalog (`catalogMode: strict`):** All external dependencies must be pinned in `pnpm-workspace.yaml` `catalog:` and consumed via `"catalog:"`.
   - **Path aliases:** Frontend apps (`apps/*`, `packages/ui`) use `@/*` via `tsconfig.json` `paths` (rewritten by Vite). Backend Node.js services (`services/*`, compiled `packages/*`) use Node.js native `#/*` subpath imports in `package.json` `"imports"` or relative `.js` ESM imports—never unrewritten `@/*` in compiled `NodeNext` targets.
5. **Security & Observability:**
   - Never log raw secrets, PII, cookies, or `x-katha-claims` headers. Always use `@katha/logger`.
   - Every service, app, and package must include a concise `README.md`.
6. **Conventional Commits & Git Hygiene:**
   - Commit messages feed semantic versioning and changelogs (`feat(...)`, `fix(...)`, `chore(...)`, `docs(...)`).
   - **Never commit, push, or create a new branch unless the owner explicitly asks** — stage nothing preemptively; present the diff for review first.
   - Commit messages must be plain Conventional Commit text — **no AI/agent attribution** (no "Generated with", `Co-Authored-By` bot trailers, or tool mentions) anywhere in the message.
7. **Code Quality & UI/UX Bar:**
   - All code follows **DRY + SOLID** — extract shared logic, keep components/modules single-responsibility, and depend on abstractions rather than concretes.
   - Design for reuse and scale (an enterprise-grade codebase, not demo code).
   - Apply UI/UX best practices by default: semantic HTML, accessibility (ARIA, keyboard navigation, contrast), responsive-first layout, and honest UI (no dead controls).
   - Use correct domain terminology and user-friendly copy. When unsure of the idiomatic pattern for a library/framework, check its official docs before implementing.
