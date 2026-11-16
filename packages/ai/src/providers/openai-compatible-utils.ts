import type { AIConversationMessage, AIToolDefinition, GenerateTextOutput } from '../provider.js';
import { AIProviderError } from '../provider-error.js';

export type ChatCompletionResponse = {
  model?: unknown;
  choices?: {
    finish_reason?: unknown;
    message?: { content?: unknown; tool_calls?: unknown };
  }[];
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
  error?: unknown;
};

export function toOpenAIMessage(message: AIConversationMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      name: message.name,
      content: message.content,
    };
  }
  if (message.role !== 'assistant') return { role: message.role, content: message.content };
  return {
    role: 'assistant',
    content: message.content,
    ...(message.toolCalls === undefined
      ? {}
      : {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        }),
  };
}

export function toOpenAITool(tool: AIToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  };
}

export async function readJson(response: Response, provider: string): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch (error: unknown) {
    throw new AIProviderError('invalid_response', `${provider} returned invalid JSON.`, {
      cause: error,
    });
  }
}

export function providerErrorDetail(payload: unknown): string {
  if (!isRecord(payload)) return '.';
  const error = payload['error'];
  if (typeof error === 'string') return `: ${error}`;
  if (isRecord(error) && typeof error['message'] === 'string') {
    return `: ${error['message']}`;
  }
  return '.';
}

export function toTextOutput(
  response: ChatCompletionResponse,
  fallbackModel: string,
): GenerateTextOutput {
  const choice = response.choices?.[0];
  const content = choice?.message?.content;
  if (!choice || typeof content !== 'string') {
    throw new AIProviderError('invalid_response', 'Chat response did not include message text.');
  }
  return {
    text: content,
    model: typeof response.model === 'string' ? response.model : fallbackModel,
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    inputTokens: finiteNumberOrNull(response.usage?.prompt_tokens),
    outputTokens: finiteNumberOrNull(response.usage?.completion_tokens),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
