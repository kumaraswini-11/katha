import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BaseServiceEnvSchema, parseEnv } from './index.js';

describe('@katha/config', () => {
  it('parses base service env with defaults', () => {
    const env = parseEnv(BaseServiceEnvSchema, {});
    expect(env).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      PORT: 3000,
      HOST: '0.0.0.0',
    });
  });

  it('coerces PORT and merges service-specific schemas', () => {
    const AuthEnvSchema = BaseServiceEnvSchema.extend({
      DATABASE_URL: z.url(),
    });

    const env = parseEnv(AuthEnvSchema, {
      NODE_ENV: 'production',
      PORT: '4001',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/auth',
    });

    expect(env.PORT).toBe(4001);
    expect(env.NODE_ENV).toBe('production');
  });

  it('never leaks raw secret values in validation error messages', () => {
    const SecretEnvSchema = BaseServiceEnvSchema.extend({
      JWT_SECRET: z.string().min(32),
    });

    const leakedAttempt = 'too-short-super-secret';
    let caughtMessage = '';
    try {
      parseEnv(SecretEnvSchema, { JWT_SECRET: leakedAttempt });
    } catch (error) {
      caughtMessage = error instanceof Error ? error.message : String(error);
    }

    expect(caughtMessage).toContain('JWT_SECRET');
    expect(caughtMessage).not.toContain(leakedAttempt);
  });
});
