import type {
  AIProvider,
  GenerateToolTurnInput,
  GenerateToolTurnOutput,
  GenerateStructuredInput,
  GenerateTextInput,
  GenerateTextOutput,
  ModelInfo,
} from '../provider.js';
import { AIProviderError } from '../provider-error.js';
import { parseOpenAIStyleToolCalls } from '../tool-call-utils.js';
import {
  isRecord,
  providerErrorDetail,
  readJson,
  toOpenAIMessage,
  toOpenAITool,
  toTextOutput,
  type ChatCompletionResponse,
} from './openai-compatible-utils.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_TOKENS = 32_768;

export interface CompatibleProviderOptions {
  readonly provider: 'groq' | 'openrouter';
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
}

export class OpenAICompatibleProvider implements AIProvider {
  private readonly provider: 'groq' | 'openrouter';
  private readonly endpoint: URL;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: CompatibleProviderOptions) {
    this.provider = options.provider;
    this.endpoint = new URL(options.endpoint);
    this.apiKey = nonEmpty(options.apiKey, 'apiKey');
    this.model = nonEmpty(options.model, 'model');
    this.timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

    if (this.provider === 'openrouter' && !isFreeOpenRouterModel(this.model)) {
      throw new AIProviderError(
        'invalid_input',
        'OpenRouter model must be openrouter/free or a model ID ending in :free.',
      );
    }
  }

  getModelInfo(): ModelInfo {
    return { provider: this.provider, model: this.model, execution: 'hosted' };
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextOutput> {
    return toTextOutput(await this.complete(input), this.model);
  }

  async generateStructured<T>(input: GenerateStructuredInput<T>): Promise<T> {
    const completion = await this.complete(input, input.schema.jsonSchema, input.schema.name);
    const text = toTextOutput(completion, this.model).text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error: unknown) {
      throw new AIProviderError(
        'invalid_structured_output',
        `${this.provider} returned content that was not valid JSON.`,
        { cause: error },
      );
    }

    try {
      return input.schema.parse(parsed);
    } catch (error: unknown) {
      throw new AIProviderError(
        'invalid_structured_output',
        `${this.provider} output did not match the ${input.schema.name} schema.`,
        { cause: error },
      );
    }
  }

  async generateToolTurn(input: GenerateToolTurnInput): Promise<GenerateToolTurnOutput> {
    const temperature = boundedNumber(input.temperature, 0, 2, 'temperature');
    const maxTokens = boundedInteger(input.maxOutputTokens, MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
    const response = await this.requestCompletion(
      {
        model: this.model,
        messages: input.messages.map(toOpenAIMessage),
        tools: input.tools.map(toOpenAITool),
        tool_choice: 'auto',
        stream: false,
        temperature,
        ...(this.provider === 'groq'
          ? { max_completion_tokens: maxTokens }
          : { max_tokens: maxTokens }),
        ...(this.provider === 'openrouter'
          ? { provider: { allow_fallbacks: false, require_parameters: true } }
          : {}),
      },
      input.signal,
    );
    const choice = response.choices?.[0];
    if (!choice?.message) {
      throw new AIProviderError(
        'invalid_response',
        `${this.provider} returned an empty completion.`,
      );
    }
    return {
      content: typeof choice.message.content === 'string' ? choice.message.content : null,
      toolCalls: parseOpenAIStyleToolCalls(choice.message.tool_calls, this.provider),
      model: typeof response.model === 'string' ? response.model : this.model,
      finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    };
  }

  private complete(
    input: GenerateTextInput,
    schema?: Readonly<Record<string, unknown>>,
    schemaName?: string,
  ): Promise<ChatCompletionResponse> {
    const userPrompt = nonEmpty(input.userPrompt, 'userPrompt');
    const temperature = boundedNumber(input.temperature, 0, 2, 'temperature');
    const maxTokens = boundedInteger(input.maxOutputTokens, MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
    const messages: { role: 'system' | 'user'; content: string }[] = [];
    if (input.systemPrompt !== undefined) {
      messages.push({ role: 'system', content: nonEmpty(input.systemPrompt, 'systemPrompt') });
    }
    messages.push({ role: 'user', content: userPrompt });

    return this.requestCompletion(
      {
        model: this.model,
        messages,
        stream: false,
        temperature,
        max_tokens: maxTokens,
        ...(schema === undefined
          ? {}
          : {
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: schemaName,
                  strict: true,
                  schema,
                },
              },
            }),
        ...(this.provider === 'openrouter'
          ? {
              provider: { allow_fallbacks: false, ...(schema ? { require_parameters: true } : {}) },
            }
          : {}),
      },
      input.signal,
    );
  }

  private async requestCompletion(
    body: unknown,
    parentSignal?: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = parentSignal ? AbortSignal.any([parentSignal, timeoutSignal]) : timeoutSignal;
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error: unknown) {
      const timedOut = timeoutSignal.aborted && !parentSignal?.aborted;
      throw new AIProviderError(
        'request_failed',
        timedOut ? `${this.provider} request timed out.` : `Unable to reach ${this.provider}.`,
        { cause: error },
      );
    }

    const payload: unknown = await readJson(response, this.provider);
    if (!response.ok) {
      throw new AIProviderError(
        'request_failed',
        `${this.provider} request failed with HTTP ${response.status}${providerErrorDetail(payload)}`,
      );
    }
    if (!isRecord(payload)) {
      throw new AIProviderError(
        'invalid_response',
        `${this.provider} returned an invalid response.`,
      );
    }
    return payload as ChatCompletionResponse;
  }
}

function isFreeOpenRouterModel(model: string): boolean {
  return model === 'openrouter/free' || model.endsWith(':free');
}

function nonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new AIProviderError('invalid_input', `${field} must not be empty.`);
  }
  return trimmed;
}

function boundedInteger(value: number | undefined, defaultValue: number, maximum: number): number {
  if (value === undefined) return defaultValue;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new AIProviderError('invalid_input', `maxOutputTokens must be between 1 and ${maximum}.`);
  }
  return value;
}

function boundedNumber(
  value: number | undefined,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (value === undefined) return minimum;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new AIProviderError(
      'invalid_input',
      `${field} must be between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}
