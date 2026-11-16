import type { AIConversationMessage, AIToolCall, AIToolDefinition } from '../provider.js';
import { AIProviderError } from '../provider-error.js';
import { isRecord, parseToolArguments, toolCallId } from '../tool-call-utils.js';

export function toOllamaMessage(message: AIConversationMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_name: message.name, content: message.content };
  }
  if (message.role !== 'assistant') return { role: message.role, content: message.content };
  return {
    role: 'assistant',
    content: message.content ?? '',
    ...(message.toolCalls === undefined
      ? {}
      : {
          tool_calls: message.toolCalls.map((call) => ({
            function: { name: call.name, arguments: call.arguments },
          })),
        }),
  };
}

export function toOllamaTool(tool: AIToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  };
}

export function parseOllamaToolCalls(value: unknown): AIToolCall[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new AIProviderError('invalid_response', 'Ollama returned malformed tool calls.');
  }
  return value.map((entry) => {
    if (!isRecord(entry) || !isRecord(entry['function'])) {
      throw new AIProviderError('invalid_response', 'Ollama returned malformed tool calls.');
    }
    const name = entry['function']['name'];
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new AIProviderError('invalid_response', 'Ollama returned a tool call without a name.');
    }
    return {
      id: toolCallId(entry['id'], 'ollama'),
      name,
      arguments: parseToolArguments(entry['function']['arguments'], 'Ollama'),
    };
  });
}
