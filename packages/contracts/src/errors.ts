import { z } from 'zod';

/** Canonical machine-readable error codes shared across all HTTP endpoints. */
export const ErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Standard error envelope returned by all Katha HTTP services. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string().min(1),
    requestId: z.string().min(1).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * Constructs a validated API error envelope.
 */
export function createApiError(
  code: ErrorCode,
  message: string,
  options?: {
    requestId?: string;
    details?: Record<string, unknown>;
  },
): ApiError {
  return {
    error: {
      code,
      message,
      ...(options?.requestId !== undefined ? { requestId: options.requestId } : {}),
      ...(options?.details !== undefined ? { details: options.details } : {}),
    },
  };
}
