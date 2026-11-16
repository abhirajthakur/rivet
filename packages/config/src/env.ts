import { z } from 'zod';

const nonEmptyUrl = z.string().trim().min(1, 'must not be empty').pipe(z.url());
const nodeEnvironment = z.enum(['development', 'test', 'production']);

export const apiEnvSchema = z.object({
  NODE_ENV: nodeEnvironment,
  PORT: z.coerce.number().int().min(1).max(65_535),
  DATABASE_URL: nonEmptyUrl,
});

export const workerEnvSchema = z.object({
  NODE_ENV: nodeEnvironment,
  DATABASE_URL: nonEmptyUrl,
  REDIS_URL: nonEmptyUrl,
  OLLAMA_BASE_URL: nonEmptyUrl,
  OLLAMA_MODEL: z.string().trim().min(1, 'must not be empty'),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseEnvironment<TSchema extends z.ZodType>(
  schema: TSchema,
  source: Readonly<Record<string, string | undefined>> = process.env,
): z.output<TSchema> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join('.') : 'environment';
      return `- ${field}: ${issue.message}`;
    });
    throw new Error(`Invalid environment configuration:\n${details.join('\n')}`);
  }

  return result.data;
}

export function loadApiEnv(source?: Readonly<Record<string, string | undefined>>): ApiEnv {
  return parseEnvironment(apiEnvSchema, source);
}

export function loadWorkerEnv(source?: Readonly<Record<string, string | undefined>>): WorkerEnv {
  return parseEnvironment(workerEnvSchema, source);
}
