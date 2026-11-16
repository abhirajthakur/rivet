import type {
  AIConversationMessage,
  AIProvider,
  AIToolCall,
  AIToolDefinition,
  GenerateToolTurnOutput,
} from '@rivet/ai';
import { createTaskTools, type AgentToolSet, type ExecutableAgentTool } from './task-tools.js';

const DEFAULT_MAX_TURNS = 8;
const HARD_MAX_TURNS = 12;
const DEFAULT_MAX_TOOL_CALLS = 24;
const HARD_MAX_TOOL_CALLS = 40;
const DEFAULT_MAX_DURATION_MS = 180_000;
const HARD_MAX_DURATION_MS = 600_000;
const DEFAULT_MAX_TOOL_RESULT_BYTES = 64 * 1024;
const HARD_MAX_TOOL_RESULT_BYTES = 256 * 1024;
const DEFAULT_MAX_CONTEXT_BYTES = 1024 * 1024;
const HARD_MAX_CONTEXT_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;
const HARD_MAX_OUTPUT_TOKENS = 8_192;

export type AgentToolLoopErrorCode = 'cancelled' | 'limit_exceeded';

export class AgentToolLoopError extends Error {
  code: AgentToolLoopErrorCode;

  constructor(code: AgentToolLoopErrorCode, message: string) {
    super(message);
    this.name = 'AgentToolLoopError';
    this.code = code;
  }
}

export type AgentToolLoopLimits = {
  maxTurns?: number;
  maxToolCalls?: number;
  maxDurationMs?: number;
  maxToolResultBytes?: number;
  maxContextBytes?: number;
  maxOutputTokens?: number;
};

export type AgentToolCallEvent = {
  callId: string;
  name: string;
  arguments: unknown;
  result: string;
  succeeded: boolean;
  durationMs: number;
};

export type AgentToolCallStartEvent = {
  callId: string;
  name: string;
  arguments: unknown;
};

export type RunAgentToolLoopInput = {
  provider: AIProvider;
  tools: AgentToolSet;
  systemPrompt: string;
  userPrompt: string;
  limits?: AgentToolLoopLimits;
  signal?: AbortSignal;
  onToolCallStart?: (event: AgentToolCallStartEvent) => Promise<void> | void;
  onToolCall?: (event: AgentToolCallEvent) => Promise<void> | void;
};

export type AgentTaskToolLoopInput = Omit<
  RunAgentToolLoopInput,
  'provider' | 'tools' | 'onToolCall' | 'onToolCallStart'
>;

export type AgentToolLoopResult = {
  finalMessage: string | null;
  turnCount: number;
  toolCallCount: number;
  durationMs: number;
};

export async function runAgentToolLoop(input: RunAgentToolLoopInput): Promise<AgentToolLoopResult> {
  const startedAt = Date.now();
  const limits = normalizeLimits(input.limits);
  const deadlineSignal = AbortSignal.timeout(limits.maxDurationMs);
  const signal = input.signal ? AbortSignal.any([input.signal, deadlineSignal]) : deadlineSignal;
  const executableTools = createTaskTools(input.tools);
  const toolsByName = new Map(executableTools.map((tool) => [tool.name, tool]));
  const toolDefinitions = executableTools.map(toDefinition);
  const messages: AIConversationMessage[] = [
    { role: 'system', content: input.systemPrompt },
    { role: 'user', content: input.userPrompt },
  ];
  let toolCallCount = 0;

  for (let turn = 1; turn <= limits.maxTurns; turn += 1) {
    throwIfAborted(input.signal, deadlineSignal);
    const conversationJson = JSON.stringify({ messages, tools: toolDefinitions }) ?? '';
    if (Buffer.byteLength(conversationJson, 'utf8') > limits.maxContextBytes) {
      throw new AgentToolLoopError(
        'limit_exceeded',
        `Agent conversation exceeded the ${limits.maxContextBytes} byte context limit.`,
      );
    }
    let response: GenerateToolTurnOutput;
    try {
      response = await input.provider.generateToolTurn({
        messages,
        tools: toolDefinitions,
        temperature: 0,
        maxOutputTokens: limits.maxOutputTokens,
        signal,
      });
    } catch (error: unknown) {
      throwIfAborted(input.signal, deadlineSignal);
      throw error;
    }
    throwIfAborted(input.signal, deadlineSignal);

    messages.push({
      role: 'assistant',
      content: response.content,
      ...(response.toolCalls.length === 0 ? {} : { toolCalls: response.toolCalls }),
    });

    if (response.toolCalls.length === 0) {
      return {
        finalMessage: response.content,
        turnCount: turn,
        toolCallCount,
        durationMs: Date.now() - startedAt,
      };
    }
    if (toolCallCount + response.toolCalls.length > limits.maxToolCalls) {
      throw new AgentToolLoopError(
        'limit_exceeded',
        `Agent exceeded the maximum of ${limits.maxToolCalls} tool calls.`,
      );
    }

    for (const call of response.toolCalls) {
      throwIfAborted(input.signal, deadlineSignal);
      const result = await executeToolCall(
        call,
        toolsByName,
        signal,
        limits.maxToolResultBytes,
        input.onToolCallStart,
        input.onToolCall,
        input.signal,
        deadlineSignal,
      );
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: result,
      });
      toolCallCount += 1;
    }
  }

  throw new AgentToolLoopError(
    'limit_exceeded',
    `Agent did not finish within ${limits.maxTurns} model turns.`,
  );
}

async function executeToolCall(
  call: AIToolCall,
  toolsByName: ReadonlyMap<string, ExecutableAgentTool>,
  signal: AbortSignal,
  maxResultBytes: number,
  onToolCallStart: RunAgentToolLoopInput['onToolCallStart'],
  onToolCall: RunAgentToolLoopInput['onToolCall'],
  parentSignal: AbortSignal | undefined,
  deadlineSignal: AbortSignal,
): Promise<string> {
  const startedAt = Date.now();
  await onToolCallStart?.({ callId: call.id, name: call.name, arguments: call.arguments });
  throwIfAborted(parentSignal, deadlineSignal);
  let succeeded = false;
  let value: unknown;
  try {
    const tool = toolsByName.get(call.name);
    if (!tool) throw new Error(`Unknown tool: ${call.name}.`);
    assertArgumentsObject(call.arguments);
    value = await tool.execute(call.arguments, signal);
    succeeded = true;
  } catch (error: unknown) {
    throwIfAborted(parentSignal, deadlineSignal);
    value = { error: error instanceof Error ? error.message : 'Tool execution failed.' };
  }

  const result = serializeToolResult(value, maxResultBytes);
  await onToolCall?.({
    callId: call.id,
    name: call.name,
    arguments: call.arguments,
    result,
    succeeded,
    durationMs: Date.now() - startedAt,
  });
  throwIfAborted(parentSignal, deadlineSignal);
  return result;
}

function assertArgumentsObject(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool arguments must be a JSON object.');
  }
}

function serializeToolResult(value: unknown, maxBytes: number): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? 'null';
  } catch {
    serialized = JSON.stringify({ error: 'Tool result could not be serialized.' });
  }
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return serialized;
  const preview = serialized.slice(0, Math.floor(maxBytes / 4));
  return JSON.stringify({ truncated: true, preview });
}

function normalizeLimits(limits: AgentToolLoopLimits | undefined): Required<AgentToolLoopLimits> {
  return {
    maxTurns: boundedLimit(limits?.maxTurns, DEFAULT_MAX_TURNS, HARD_MAX_TURNS, 'maxTurns'),
    maxToolCalls: boundedLimit(
      limits?.maxToolCalls,
      DEFAULT_MAX_TOOL_CALLS,
      HARD_MAX_TOOL_CALLS,
      'maxToolCalls',
    ),
    maxDurationMs: boundedLimit(
      limits?.maxDurationMs,
      DEFAULT_MAX_DURATION_MS,
      HARD_MAX_DURATION_MS,
      'maxDurationMs',
    ),
    maxToolResultBytes: boundedLimit(
      limits?.maxToolResultBytes,
      DEFAULT_MAX_TOOL_RESULT_BYTES,
      HARD_MAX_TOOL_RESULT_BYTES,
      'maxToolResultBytes',
    ),
    maxContextBytes: boundedLimit(
      limits?.maxContextBytes,
      DEFAULT_MAX_CONTEXT_BYTES,
      HARD_MAX_CONTEXT_BYTES,
      'maxContextBytes',
    ),
    maxOutputTokens: boundedLimit(
      limits?.maxOutputTokens,
      DEFAULT_MAX_OUTPUT_TOKENS,
      HARD_MAX_OUTPUT_TOKENS,
      'maxOutputTokens',
    ),
  };
}

function boundedLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new AgentToolLoopError(
      'limit_exceeded',
      `${name} must be an integer from 1 to ${maximum}.`,
    );
  }
  return value;
}

function throwIfAborted(parentSignal: AbortSignal | undefined, deadlineSignal: AbortSignal): void {
  if (parentSignal?.aborted) {
    throw new AgentToolLoopError('cancelled', 'Agent tool loop was cancelled.');
  }
  if (deadlineSignal.aborted) {
    throw new AgentToolLoopError('limit_exceeded', 'Agent tool loop exceeded its time limit.');
  }
}

function toDefinition(tool: ExecutableAgentTool): AIToolDefinition {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}
