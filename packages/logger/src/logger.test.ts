import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from './index.js';

function createMemoryStream(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('@katha/logger', () => {
  it('emits structured JSON logs with service metadata and severity', () => {
    const { stream, lines } = createMemoryStream();
    const logger = createLogger({ service: 'auth-service', destination: stream });

    logger.info({ userId: 'usr_123' }, 'Session verified');

    const [entry] = lines();
    expect(entry).toMatchObject({
      service: 'auth-service',
      level: 'info',
      severity: 'INFO',
      userId: 'usr_123',
      msg: 'Session verified',
    });
    expect(typeof entry?.time).toBe('string');
  });

  it('redacts sensitive fields and auth headers', () => {
    const { stream, lines } = createMemoryStream();
    const logger = createLogger({ service: 'api-gateway', destination: stream });

    logger.info(
      {
        password: 'plain-password',
        req: {
          headers: {
            authorization: 'Bearer secret-token',
            cookie: 'session=secret',
            'x-katha-claims': 'signed.jwt.claims',
          },
        },
      },
      'Inbound request',
    );

    const [entry] = lines();
    expect(entry?.password).toBe('[REDACTED]');
    const req = entry?.req as { headers: Record<string, unknown> };
    expect(req.headers.authorization).toBe('[REDACTED]');
    expect(req.headers.cookie).toBe('[REDACTED]');
    expect(req.headers['x-katha-claims']).toBe('[REDACTED]');
  });
});
