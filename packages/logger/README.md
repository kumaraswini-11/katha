# `@katha/logger`

Standardized Pino structured JSON logger factory for Fastify v5 (`loggerInstance`), Kafka consumers, BullMQ workers, and gRPC servers.

## Features

- Automatic redaction of sensitive keys (`password`, `token`, `secret`, `authorization`, `cookie`, `x-katha-claims`)
- Consistent `service`, `level`, `severity`, and ISO timestamps across every deployable

## Commands

```bash
pnpm --filter @katha/logger build
pnpm --filter @katha/logger check-types
pnpm --filter @katha/logger test
```
