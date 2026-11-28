import { z } from 'zod';

/** Supported runtime environments. */
export const NodeEnvSchema = z.enum(['development', 'test', 'production']);
export type NodeEnv = z.infer<typeof NodeEnvSchema>;

/** Supported structured log levels. */
export const LogLevelSchema = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

/** Base environment variables shared by every backend service and worker. */
export const BaseServiceEnvSchema = z.object({
  NODE_ENV: NodeEnvSchema.default('development'),
  LOG_LEVEL: LogLevelSchema.default('info'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
});
export type BaseServiceEnv = z.infer<typeof BaseServiceEnvSchema>;

/**
 * Validates environment variables against a Zod schema.
 * Never includes raw secret values in thrown error messages.
 */
export function parseEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  rawEnv: Record<string, string | undefined> = process.env,
): z.infer<TSchema> {
  const result = schema.safeParse(rawEnv);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    })
    .join('; ');

  throw new Error(`Invalid environment configuration: ${issues}`);
}
