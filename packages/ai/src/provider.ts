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

export interface AIProvider {
  getModelInfo(): ModelInfo;
  generateText(input: GenerateTextInput): Promise<GenerateTextOutput>;
  generateStructured<T>(input: GenerateStructuredInput<T>): Promise<T>;
}
