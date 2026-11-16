import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import type { AIProvider, GenerateStructuredInput, GenerateTextInput } from './provider.js';
import type { GenerateTextOutput, ModelInfo } from './provider.js';

export interface GroqProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
}

export class GroqProvider implements AIProvider {
  private readonly provider: OpenAICompatibleProvider;

  constructor(options: GroqProviderOptions) {
    this.provider = new OpenAICompatibleProvider({
      provider: 'groq',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: options.apiKey,
      model: options.model,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  }

  getModelInfo(): ModelInfo {
    return this.provider.getModelInfo();
  }

  generateText(input: GenerateTextInput): Promise<GenerateTextOutput> {
    return this.provider.generateText(input);
  }

  generateStructured<T>(input: GenerateStructuredInput<T>): Promise<T> {
    return this.provider.generateStructured(input);
  }
}
