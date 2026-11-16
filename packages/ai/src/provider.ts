export type ModelInfo = {
  provider: string;
  model: string;
  execution: 'self_hosted' | 'hosted';
};

export type GenerateTextInput = {
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export type GenerateTextOutput = {
  text: string;
  model: string;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type StructuredOutputSchema<T> = {
  name: string;
  jsonSchema: Record<string, unknown>;
  parse(value: unknown): T;
};

export type GenerateStructuredInput<T> = Omit<GenerateTextInput, 'maxOutputTokens'> & {
  schema: StructuredOutputSchema<T>;
  maxOutputTokens?: number;
};

export type AIToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type AIToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type AIConversationMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      toolCalls?: AIToolCall[];
    }
  | {
      role: 'tool';
      toolCallId: string;
      name: string;
      content: string;
    };

export type GenerateToolTurnInput = {
  messages: AIConversationMessage[];
  tools: AIToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export type GenerateToolTurnOutput = {
  content: string | null;
  toolCalls: AIToolCall[];
  model: string;
  finishReason: string | null;
};

export interface AIProvider {
  getModelInfo(): ModelInfo;
  generateText(input: GenerateTextInput): Promise<GenerateTextOutput>;
  generateStructured<T>(input: GenerateStructuredInput<T>): Promise<T>;
  generateToolTurn(input: GenerateToolTurnInput): Promise<GenerateToolTurnOutput>;
}
