import type { AIConversationMessage, AIToolCall, AIToolDefinition } from '../provider.js';
import { AIProviderError } from '../provider-error.js';
import { isRecord, parseToolArguments, toolCallId } from '../tool-call-utils.js';

export function toGeminiContents(
  messages: readonly AIConversationMessage[],
): Record<string, unknown>[] {
  return messages.flatMap((message) => {
    if (message.role === 'system') return [];
    if (message.role === 'user') {
      return [{ role: 'user', parts: [{ text: message.content }] }];
    }
    if (message.role === 'tool') {
      return [
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: message.toolCallId,
                name: message.name,
                response: { result: parseToolResult(message.content) },
              },
            },
          ],
        },
      ];
    }
    if (message.role !== 'assistant') return [];

    const parts: Record<string, unknown>[] = [];
    if (message.content) parts.push({ text: message.content });
    for (const call of message.toolCalls ?? []) {
      parts.push({ functionCall: { id: call.id, name: call.name, args: call.arguments } });
    }
    return [{ role: 'model', parts }];
  });
}

export function toGeminiToolDeclarations(
  tools: readonly AIToolDefinition[],
): Record<string, unknown>[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.inputSchema,
      })),
    },
  ];
}

export function parseGeminiToolCalls(parts: unknown): AIToolCall[] {
  if (!Array.isArray(parts)) return [];
  return parts.flatMap((part) => {
    if (!isRecord(part) || !isRecord(part['functionCall'])) return [];
    const functionCall = part['functionCall'];
    const name = functionCall['name'];
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new AIProviderError(
        'invalid_response',
        'Gemini returned a function call without a name.',
      );
    }
    return [
      {
        id: toolCallId(functionCall['id'], 'gemini'),
        name,
        arguments: parseToolArguments(functionCall['args'] ?? {}, 'Gemini'),
      },
    ];
  });
}

function parseToolResult(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return { output: content };
  }
}
