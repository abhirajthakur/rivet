import { randomUUID } from 'node:crypto';
import type { AIToolCall } from './provider.js';
import { AIProviderError } from './provider-error.js';

export function parseToolArguments(value: unknown, provider: string): unknown {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch (error: unknown) {
      throw new AIProviderError(
        'invalid_response',
        `${provider} returned invalid JSON in tool arguments.`,
        { cause: error },
      );
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AIProviderError(
      'invalid_response',
      `${provider} returned non-object tool arguments.`,
    );
  }
  return parsed;
}

export function toolCallId(providerId: unknown, provider: string): string {
  return typeof providerId === 'string' && providerId.length > 0
    ? providerId
    : `${provider}-${randomUUID()}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseOpenAIStyleToolCalls(value: unknown, provider: string): AIToolCall[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new AIProviderError('invalid_response', `${provider} returned malformed tool calls.`);
  }
  return value.map((entry) => {
    if (!isRecord(entry) || !isRecord(entry['function'])) {
      throw new AIProviderError('invalid_response', `${provider} returned malformed tool calls.`);
    }
    const callName = entry['function']['name'];
    if (typeof callName !== 'string' || callName.trim().length === 0) {
      throw new AIProviderError(
        'invalid_response',
        `${provider} returned a tool call without a name.`,
      );
    }
    return {
      id: toolCallId(entry['id'], provider),
      name: callName,
      arguments: parseToolArguments(entry['function']['arguments'], provider),
    };
  });
}
