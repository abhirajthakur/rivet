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

export type CompatibleProviderOptions = {
  providerName: string;
  endpoint: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  adaptRequest?: (
    kind: 'text' | 'structured' | 'tool_call',
    request: Record<string, unknown>,
  ) => Record<string, unknown>;
};

export class OpenAICompatibleProvider implements AIProvider {
  private readonly providerName: string;
  private readonly endpoint: URL;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly adaptRequest?: CompatibleProviderOptions['adaptRequest'];

  constructor(options: CompatibleProviderOptions) {
    this.providerName = nonEmpty(options.providerName, 'providerName');
    this.endpoint = new URL(options.endpoint);
    this.apiKey = nonEmpty(options.apiKey, 'apiKey');
    this.model = nonEmpty(options.model, 'model');
    this.timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    this.adaptRequest = options.adaptRequest;
  }

  getModelInfo(): ModelInfo {
    return { provider: this.providerName, model: this.model, execution: 'hosted' };
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
        `${this.providerName} returned content that was not valid JSON.`,
        { cause: error },
      );
    }

    try {
      return input.schema.parse(parsed);
    } catch (error: unknown) {
      throw new AIProviderError(
        'invalid_structured_output',
        `${this.providerName} output did not match the ${input.schema.name} schema.`,
        { cause: error },
      );
    }
  }

  async generateToolTurn(input: GenerateToolTurnInput): Promise<GenerateToolTurnOutput> {
    const temperature = boundedNumber(input.temperature, 0, 2, 'temperature');
    const maxTokens = boundedInteger(input.maxOutputTokens, MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
    const response = await this.requestCompletion(
      this.buildRequest('tool_call', {
        model: this.model,
        messages: input.messages.map(toOpenAIMessage),
        tools: input.tools.map(toOpenAITool),
        tool_choice: 'auto',
        stream: false,
        temperature,
        max_tokens: maxTokens,
      }),
      input.signal,
    );
    const choice = response.choices?.[0];
    if (!choice?.message) {
      throw new AIProviderError(
        'invalid_response',
        `${this.providerName} returned an empty completion.`,
      );
    }
    return {
      content: typeof choice.message.content === 'string' ? choice.message.content : null,
      toolCalls: parseOpenAIStyleToolCalls(choice.message.tool_calls, this.providerName),
      model: typeof response.model === 'string' ? response.model : this.model,
      finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    };
  }

  private complete(
    input: GenerateTextInput,
    schema?: Record<string, unknown>,
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
      this.buildRequest(schema === undefined ? 'text' : 'structured', {
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
      }),
      input.signal,
    );
  }

  private buildRequest(
    kind: 'text' | 'structured' | 'tool_call',
    request: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.adaptRequest?.(kind, request) ?? request;
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
        timedOut
          ? `${this.providerName} request timed out.`
          : `Unable to reach ${this.providerName}.`,
        { cause: error },
      );
    }

    const payload: unknown = await readJson(response, this.providerName);
    if (!response.ok) {
      throw new AIProviderError(
        'request_failed',
        `${this.providerName} request failed with HTTP ${response.status}${providerErrorDetail(payload)}`,
      );
    }
    if (!isRecord(payload)) {
      throw new AIProviderError(
        'invalid_response',
        `${this.providerName} returned an invalid response.`,
      );
    }
    return payload as ChatCompletionResponse;
  }
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
