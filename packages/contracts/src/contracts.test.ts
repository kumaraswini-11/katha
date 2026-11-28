import { describe, expect, it } from 'vitest';

import {
  ApiErrorSchema,
  CLAIMS_HEADER,
  ClaimsPayloadSchema,
  createApiError,
  HealthResponseSchema,
} from './index.js';

describe('@katha/contracts', () => {
  it('validates canonical claims payload', () => {
    const parsed = ClaimsPayloadSchema.parse({
      sub: 'usr_123',
      email: 'alice@katha.dev',
      sid: 'ses_456',
      aud: 'internal',
      iat: 1_700_000_000,
      exp: 1_700_000_060,
      v: 1,
    });

    expect(parsed.aud).toBe('internal');
    expect(CLAIMS_HEADER).toBe('x-katha-claims');
  });

  it('rejects malformed claims payload', () => {
    const result = ClaimsPayloadSchema.safeParse({
      sub: 'usr_123',
      email: 'not-an-email',
      sid: 'ses_456',
      aud: 'unknown',
      iat: 100,
      exp: 200,
      v: 2,
    });

    expect(result.success).toBe(false);
  });

  it('creates and validates API error envelopes', () => {
    const err = createApiError('UNAUTHORIZED', 'Invalid or expired session', {
      requestId: 'req_001',
    });

    expect(ApiErrorSchema.parse(err)).toEqual(err);
  });

  it('validates service health response schema', () => {
    const payload = {
      status: 'ok' as const,
      service: 'auth-service',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      checks: { postgres: 'ok' as const },
    };

    expect(HealthResponseSchema.parse(payload)).toEqual(payload);
  });
});
