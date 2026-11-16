import type {
  AIProvider,
  GenerateStructuredInput,
  GenerateToolTurnInput,
  GenerateToolTurnOutput,
  GenerateTextInput,
  GenerateTextOutput,
  ModelInfo,
} from '../provider.js';
import { AIProviderError } from '../provider-error.js';
import { readJson } from './openai-compatible-utils.js';
import {
  parseGeminiToolCalls,
  toGeminiContents,
  toGeminiToolDeclarations,
} from './gemini-tools.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_TOKENS = 32_768;

export type GeminiProviderOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
};

type GeminiResponse = {
  modelVersion?: unknown;
  candidates?: {
    content?: {
      parts?: { text?: unknown; functionCall?: unknown }[];
    };
    finishReason?: unknown;
  }[];
  usageMetadata?: {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
  };
  promptFeedback?: { blockReason?: unknown };
  error?: unknown;
};

export class GeminiProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: GeminiProviderOptions) {
    this.apiKey = nonEmpty(options.apiKey, 'apiKey');
    this.model = nonEmpty(options.model, 'model');
    this.timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  }

  getModelInfo(): ModelInfo {
    return { provider: 'gemini', model: this.model, execution: 'hosted' };
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextOutput> {
    return toTextOutput(await this.generate(input), this.model);
  }

  async generateStructured<T>(input: GenerateStructuredInput<T>): Promise<T> {
    const response = await this.generate(input, input.schema.jsonSchema);
    const text = toTextOutput(response, this.model).text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error: unknown) {
      throw new AIProviderError(
        'invalid_structured_output',
        'Gemini returned content that was not valid JSON.',
        { cause: error },
      );
    }

    try {
      return input.schema.parse(parsed);
    } catch (error: unknown) {
      throw new AIProviderError(
        'invalid_structured_output',
        `Gemini output did not match the ${input.schema.name} schema.`,
        { cause: error },
      );
    }
  }

  async generateToolTurn(input: GenerateToolTurnInput): Promise<GenerateToolTurnOutput> {
    const systemPrompt = input.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const response = await this.requestGenerate(
      {
        contents: toGeminiContents(input.messages),
        ...(systemPrompt.length === 0
          ? {}
          : { systemInstruction: { parts: [{ text: systemPrompt }] } }),
        tools: toGeminiToolDeclarations(input.tools),
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: {
          temperature: boundedNumber(input.temperature, 0, 2),
          maxOutputTokens: boundedInteger(
            input.maxOutputTokens,
            MAX_OUTPUT_TOKENS,
            MAX_OUTPUT_TOKENS,
          ),
        },
      },
      input.signal,
    );
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts;
    const content = parts?.map((part) => (typeof part.text === 'string' ? part.text : '')).join('');
    const toolCalls = parseGeminiToolCalls(parts);
    if ((typeof content !== 'string' || content.length === 0) && toolCalls.length === 0) {
      throw new AIProviderError(
        'invalid_response',
        'Gemini returned neither text nor function calls.',
      );
    }
    return {
      content: typeof content === 'string' && content.length > 0 ? content : null,
      toolCalls,
      model: typeof response.modelVersion === 'string' ? response.modelVersion : this.model,
      finishReason: typeof candidate?.finishReason === 'string' ? candidate.finishReason : null,
    };
  }

  private generate(
    input: GenerateTextInput,
    responseJsonSchema?: Record<string, unknown>,
  ): Promise<GeminiResponse> {
    const userPrompt = nonEmpty(input.userPrompt, 'userPrompt');
    const temperature = boundedNumber(input.temperature, 0, 2);
    const maxOutputTokens = boundedInteger(
      input.maxOutputTokens,
      MAX_OUTPUT_TOKENS,
      MAX_OUTPUT_TOKENS,
    );
    const body = {
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      ...(input.systemPrompt === undefined
        ? {}
        : {
            systemInstruction: { parts: [{ text: nonEmpty(input.systemPrompt, 'systemPrompt') }] },
          }),
      generationConfig: {
        temperature,
        maxOutputTokens,
        ...(responseJsonSchema === undefined
          ? {}
          : { responseMimeType: 'application/json', responseJsonSchema }),
      },
    };

    return this.requestGenerate(body, input.signal);
  }

  private async requestGenerate(
    body: unknown,
    parentSignal?: AbortSignal,
  ): Promise<GeminiResponse> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = parentSignal ? AbortSignal.any([parentSignal, timeoutSignal]) : timeoutSignal;
    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify(body),
          signal,
        },
      );
    } catch (error: unknown) {
      const timedOut = timeoutSignal.aborted && !parentSignal?.aborted;
      throw new AIProviderError(
        'request_failed',
        timedOut ? 'Gemini request timed out.' : 'Unable to reach Gemini.',
        { cause: error },
      );
    }

    const payload: unknown = await readJson(response, 'Gemini');
    if (!response.ok) {
      throw new AIProviderError(
        'request_failed',
        `Gemini request failed with HTTP ${response.status}${errorDetail(payload)}`,
      );
    }
    if (!isRecord(payload)) {
      throw new AIProviderError('invalid_response', 'Gemini returned an invalid response.');
    }
    return payload as GeminiResponse;
  }
}

function toTextOutput(response: GeminiResponse, fallbackModel: string): GenerateTextOutput {
  const candidate = response.candidates?.[0];
  const text = candidate?.content?.parts
    ?.map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('');
  if (typeof text !== 'string' || text.length === 0) {
    const blockReason = response.promptFeedback?.blockReason;
    if (typeof blockReason === 'string') {
      throw new AIProviderError('request_failed', `Gemini blocked the response: ${blockReason}.`);
    }
    throw new AIProviderError('invalid_response', 'Gemini response did not include text.');
  }
  return {
    text,
    model: typeof response.modelVersion === 'string' ? response.modelVersion : fallbackModel,
    finishReason: typeof candidate?.finishReason === 'string' ? candidate.finishReason : null,
    inputTokens: finiteNumberOrNull(response.usageMetadata?.promptTokenCount),
    outputTokens: finiteNumberOrNull(response.usageMetadata?.candidatesTokenCount),
  };
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

function boundedNumber(value: number | undefined, minimum: number, maximum: number): number {
  if (value === undefined) return minimum;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new AIProviderError(
      'invalid_input',
      `temperature must be between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorDetail(payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload['error'])) return '.';
  const message = payload['error']['message'];
  return typeof message === 'string' ? `: ${message}` : '.';
}
