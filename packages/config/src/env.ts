import { z } from 'zod';

const nonEmptyUrl = z.string().trim().min(1, 'must not be empty').pipe(z.url());
const nonEmptyString = z.string().trim().min(1, 'must not be empty');
const nodeEnvironment = z.enum(['development', 'test', 'production']);
const workerCommon = {
  NODE_ENV: nodeEnvironment,
  DATABASE_URL: nonEmptyUrl,
  REDIS_URL: nonEmptyUrl,
};

export const apiEnvSchema = z.object({
  NODE_ENV: nodeEnvironment,
  PORT: z.coerce.number().int().min(1).max(65_535),
  DATABASE_URL: nonEmptyUrl,
});

export const workerEnvSchema = z.discriminatedUnion('AI_PROVIDER', [
  z.object({
    ...workerCommon,
    AI_PROVIDER: z.literal('ollama'),
    OLLAMA_BASE_URL: nonEmptyUrl,
    OLLAMA_MODEL: nonEmptyString,
  }),
  z.object({
    ...workerCommon,
    AI_PROVIDER: z.literal('groq'),
    GROQ_API_KEY: nonEmptyString,
    GROQ_MODEL: nonEmptyString,
  }),
  z.object({
    ...workerCommon,
    AI_PROVIDER: z.literal('gemini'),
    GEMINI_API_KEY: nonEmptyString,
    GEMINI_MODEL: nonEmptyString,
  }),
  z.object({
    ...workerCommon,
    AI_PROVIDER: z.literal('openrouter'),
    OPENROUTER_API_KEY: nonEmptyString,
    OPENROUTER_MODEL: nonEmptyString.refine(
      (model) => model === 'openrouter/free' || model.endsWith(':free'),
      'must be openrouter/free or a model ID ending in :free',
    ),
  }),
]);

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseEnvironment<TSchema extends z.ZodType>(
  schema: TSchema,
  source: Record<string, string | undefined> = process.env,
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

export function loadApiEnv(source?: Record<string, string | undefined>): ApiEnv {
  return parseEnvironment(apiEnvSchema, source);
}

export function loadWorkerEnv(source?: Record<string, string | undefined>): WorkerEnv {
  return parseEnvironment(workerEnvSchema, source);
}
