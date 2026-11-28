import { z } from 'zod';

/**
 * Target audience for minted internal identity claims.
 * - `internal`: Gateway-to-service HTTP and gRPC requests.
 * - `realtime`: Single-purpose WebSocket handshake ticket.
 */
export const ClaimAudienceSchema = z.enum(['internal', 'realtime']);
export type ClaimAudience = z.infer<typeof ClaimAudienceSchema>;

/**
 * Verified claims payload minted by `api-gateway` (EdDSA) and verified locally
 * by downstream microservices. Never contains workspace/role claims.
 */
export const ClaimsPayloadSchema = z.object({
  sub: z.string().min(1),
  email: z.email(),
  sid: z.string().min(1),
  aud: ClaimAudienceSchema,
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  v: z.literal(1),
});
export type ClaimsPayload = z.infer<typeof ClaimsPayloadSchema>;

/** Canonical header name carrying signed claims from gateway to services. */
export const CLAIMS_HEADER = 'x-katha-claims' as const;

/** Canonical header name carrying W3C/gateway correlation request ID. */
export const REQUEST_ID_HEADER = 'x-request-id' as const;
