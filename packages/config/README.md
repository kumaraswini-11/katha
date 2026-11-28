# `@katha/config`

Typed environment variable validation for Katha services and workers using Zod.

## Features

- `BaseServiceEnvSchema` (`NODE_ENV`, `LOG_LEVEL`, `PORT`, `HOST`)
- `parseEnv(schema, rawEnv)` — fails fast on startup with field-level diagnostics while never echoing raw secret values.

## Commands

```bash
pnpm --filter @katha/config build
pnpm --filter @katha/config check-types
pnpm --filter @katha/config test
```
