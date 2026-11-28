# Katha

Real-time workspace chat platform built on an event-driven microservices architecture.

## Stack

- **Monorepo:** Turborepo (`turbo boundaries`) + `pnpm` (`catalogMode: strict`, 7-day `minimumReleaseAge`)
- **Language & Compiler:** TypeScript 7 (`tsc`) on Node.js 26 (ESM)
- **Lint & Format:** Pure Biome (formatting, linting, import grouping, Tailwind CSS class sorting)
- **Backend Services _(phased)_:** Fastify v5, Zod (`fastify-type-provider-zod`), Drizzle ORM + PostgreSQL, Redis, Kafka (KRaft), BullMQ, Better Auth, raw `ws`, gRPC, OpenTelemetry (`@fastify/otel`)
- **Frontend _(phased)_:** TanStack Start + TanStack Router + Vite + Tailwind CSS v4 + shadcn/ui
- **Testing:** Vitest, Testcontainers, Playwright

## Workspace Layout

```text
katha/
├── apps/          # Frontend applications (web — Step 0.4)
├── services/      # Deployable backend microservices (auth-service — Step 0.2+)
└── packages/      # Shared internal libraries
    ├── tsconfig/  # Shared TypeScript 7 compiler bases
    ├── contracts/ # Shared Zod schemas (claims, errors, health)
    ├── config/    # Safe environment parsing & base service env schema
    └── logger/    # Shared Pino logger factory with redaction
```

## Prerequisites

- **Node.js** `>= 26.0.0`
- **pnpm** `>= 12.0.0`

## Quick Start

```bash
pnpm install
pnpm ci:lint
pnpm boundaries
pnpm check-types
pnpm build
pnpm test
```

## License

[MIT](./LICENSE)
