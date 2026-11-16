export interface ModelInfo {
  readonly provider: string;
  readonly model: string;
  readonly execution: 'self_hosted' | 'hosted';
}

export interface GenerateTextInput {
  readonly systemPrompt?: string;
  readonly userPrompt: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
}

export interface GenerateTextOutput {
  readonly text: string;
  readonly model: string;
  readonly finishReason: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

export interface StructuredOutputSchema<T> {
  readonly name: string;
  readonly jsonSchema: Readonly<Record<string, unknown>>;
  parse(value: unknown): T;
}

export interface GenerateStructuredInput<T> extends Omit<GenerateTextInput, 'maxOutputTokens'> {
  readonly schema: StructuredOutputSchema<T>;
  readonly maxOutputTokens?: number;
}

export interface AIToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface AIToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

export type AIConversationMessage =
  | { readonly role: 'system' | 'user'; readonly content: string }
  | {
      readonly role: 'assistant';
      readonly content: string | null;
      readonly toolCalls?: readonly AIToolCall[];
    }
  | {
      readonly role: 'tool';
      readonly toolCallId: string;
      readonly name: string;
      readonly content: string;
    };

export interface GenerateToolTurnInput {
  readonly messages: readonly AIConversationMessage[];
  readonly tools: readonly AIToolDefinition[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
}

export interface GenerateToolTurnOutput {
  readonly content: string | null;
  readonly toolCalls: readonly AIToolCall[];
  readonly model: string;
  readonly finishReason: string | null;
}

export interface AIProvider {
  getModelInfo(): ModelInfo;
  generateText(input: GenerateTextInput): Promise<GenerateTextOutput>;
  generateStructured<T>(input: GenerateStructuredInput<T>): Promise<T>;
  generateToolTurn(input: GenerateToolTurnInput): Promise<GenerateToolTurnOutput>;
}
