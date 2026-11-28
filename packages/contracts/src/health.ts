import { z } from 'zod';

/** Health state reported by a service or individual dependency probe. */
export const HealthStatusSchema = z.enum(['ok', 'degraded', 'down']);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

/** Standardized `/health` and `/ready` response payload across all services. */
export const HealthResponseSchema = z.object({
  status: HealthStatusSchema,
  service: z.string().min(1),
  version: z.string().min(1),
  timestamp: z.iso.datetime(),
  checks: z.record(z.string(), HealthStatusSchema).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
