import {
  type AIProvider,
  type GenerateStructuredInput,
  type GenerateTextInput,
  type GenerateTextOutput,
  type ModelInfo,
} from '../provider.js';
import { AIProviderError } from '../provider-error.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_TOKENS = 32_768;

export interface OllamaProviderOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs?: number;
}

interface OllamaChatResponse {
  readonly model?: unknown;
  readonly message?: { readonly content?: unknown };
  readonly done_reason?: unknown;
  readonly prompt_eval_count?: unknown;
  readonly eval_count?: unknown;
  readonly error?: unknown;
}

export class OllamaProvider implements AIProvider {
  private readonly chatUrl: URL;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: OllamaProviderOptions) {
    this.chatUrl = parseBaseUrl(options.baseUrl);
    this.model = nonEmpty(options.model, 'model');
    this.timeoutMs = boundedInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
      'timeoutMs',
    );
  }

  getModelInfo(): ModelInfo {
    return { provider: 'ollama', model: this.model, execution: 'self_hosted' };
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextOutput> {
    const output = await this.chat(input);
    return toTextOutput(output, this.model);
  }

  async generateStructured<T>(input: GenerateStructuredInput<T>): Promise<T> {
    const output = await this.chat(input, input.schema.jsonSchema);
    const text = toTextOutput(output, this.model).text;

    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch (error: unknown) {
      throw new AIProviderError(
        'invalid_structured_output',
        'Ollama returned content that was not valid JSON.',
        { cause: error },
      );
    }

    try {
      return input.schema.parse(value);
    } catch (error: unknown) {
      throw new AIProviderError(
        'invalid_structured_output',
        `Ollama output did not match the ${input.schema.name} schema.`,
        { cause: error },
      );
    }
  }

  private async chat(
    input: GenerateTextInput,
    format?: Readonly<Record<string, unknown>>,
  ): Promise<OllamaChatResponse> {
    const userPrompt = nonEmpty(input.userPrompt, 'userPrompt');
    const temperature = boundedNumber(input.temperature, 0, 2, 'temperature');
    const maxOutputTokens = boundedInteger(
      input.maxOutputTokens,
      MAX_OUTPUT_TOKENS,
      MAX_OUTPUT_TOKENS,
      'maxOutputTokens',
    );
    const messages: { role: 'system' | 'user'; content: string }[] = [];
    if (input.systemPrompt !== undefined) {
      messages.push({ role: 'system', content: nonEmpty(input.systemPrompt, 'systemPrompt') });
    }
    messages.push({ role: 'user', content: userPrompt });

    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal;
    let response: Response;
    try {
      response = await fetch(this.chatUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          ...(format === undefined ? {} : { format }),
          options: { temperature, num_predict: maxOutputTokens },
        }),
        signal,
      });
    } catch (error: unknown) {
      const timedOut = timeoutSignal.aborted && !input.signal?.aborted;
      throw new AIProviderError(
        'request_failed',
        timedOut ? 'Ollama request timed out.' : 'Unable to reach the configured Ollama server.',
        { cause: error },
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error: unknown) {
      throw new AIProviderError('invalid_response', 'Ollama returned an invalid response.', {
        cause: error,
      });
    }

    if (!response.ok) {
      const serverMessage =
        isRecord(payload) && typeof payload['error'] === 'string'
          ? ` ${payload['error']}`
          : '';
      throw new AIProviderError(
        'request_failed',
        `Ollama request failed with HTTP ${response.status}.${serverMessage}`,
      );
    }
    if (!isRecord(payload)) {
      throw new AIProviderError('invalid_response', 'Ollama returned an invalid response.');
    }

    return payload as OllamaChatResponse;
  }
}

function parseBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(nonEmpty(value, 'baseUrl'));
  } catch (error: unknown) {
    if (error instanceof AIProviderError) throw error;
    throw new AIProviderError('invalid_input', 'Ollama baseUrl must be a valid HTTP URL.', {
      cause: error,
    });
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new AIProviderError(
      'invalid_input',
      'Ollama baseUrl must use HTTP or HTTPS and must not contain credentials.',
    );
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/api/chat`;
  url.search = '';
  url.hash = '';
  return url;
}

function toTextOutput(response: OllamaChatResponse, fallbackModel: string): GenerateTextOutput {
  const content = response.message?.content;
  if (typeof content !== 'string') {
    throw new AIProviderError('invalid_response', 'Ollama response did not include message text.');
  }
  return {
    text: content,
    model: typeof response.model === 'string' ? response.model : fallbackModel,
    finishReason: typeof response.done_reason === 'string' ? response.done_reason : null,
    inputTokens: finiteNumberOrNull(response.prompt_eval_count),
    outputTokens: finiteNumberOrNull(response.eval_count),
  };
}

function nonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new AIProviderError('invalid_input', `${field} must not be empty.`);
  }
  return trimmed;
}

function boundedInteger(
  value: number | undefined,
  defaultValue: number,
  maximum: number,
  field: string,
): number {
  if (value === undefined) return defaultValue;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new AIProviderError(
      'invalid_input',
      `${field} must be an integer between 1 and ${maximum}.`,
    );
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
    throw new AIProviderError('invalid_input', `${field} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
