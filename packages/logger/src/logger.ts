import pino, {
  type DestinationStream,
  type LevelWithSilent,
  type Logger,
  type LoggerOptions,
} from 'pino';

/** Sensitive field paths redacted across all HTTP, gRPC, Kafka, and worker logs. */
export const DEFAULT_REDACT_PATHS: readonly string[] = [
  'password',
  '*.password',
  'confirmPassword',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.headers["x-katha-claims"]',
];

export interface CreateLoggerOptions {
  /** Logical service or worker identifier included on every log record. */
  service: string;
  /** Minimum log level (defaults to `info`). */
  level?: LevelWithSilent;
  /** Additional Pino redaction paths appended to `DEFAULT_REDACT_PATHS`. */
  redactPaths?: readonly string[];
  /** Optional stream destination (primarily for testing). */
  destination?: DestinationStream;
}

/**
 * Builds standardized Pino options shared across Fastify (`loggerInstance`),
 * Kafka consumers, BullMQ workers, and gRPC servers.
 */
export function createLoggerOptions(options: CreateLoggerOptions): LoggerOptions {
  const level = options.level ?? 'info';
  const paths = [...DEFAULT_REDACT_PATHS, ...(options.redactPaths ?? [])];

  return {
    level,
    base: {
      service: options.service,
    },
    redact: {
      paths,
      censor: '[REDACTED]',
    },
    formatters: {
      level(label) {
        return { level: label, severity: label.toUpperCase() };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
}

/**
 * Creates a Pino logger instance compatible with Fastify v5 `loggerInstance`.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const pinoOptions = createLoggerOptions(options);
  return options.destination !== undefined
    ? pino(pinoOptions, options.destination)
    : pino(pinoOptions);
}
