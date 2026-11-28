# `@katha/contracts`

Pure Zod contract schemas and canonical constants shared across Katha edge and service boundaries.

## Exports

- `ClaimsPayloadSchema`, `ClaimAudienceSchema`, `CLAIMS_HEADER`, `REQUEST_ID_HEADER`
- `ApiErrorSchema`, `ErrorCodeSchema`, `createApiError`
- `HealthResponseSchema`, `HealthStatusSchema`

## Commands

```bash
pnpm --filter @katha/contracts build
pnpm --filter @katha/contracts check-types
pnpm --filter @katha/contracts test
```
