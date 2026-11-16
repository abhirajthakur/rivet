import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import { AIProviderError } from '../provider-error.js';
import type {
  AIProvider,
  GenerateStructuredInput,
  GenerateTextInput,
  GenerateToolTurnInput,
  GenerateToolTurnOutput,
} from '../provider.js';
import type { GenerateTextOutput, ModelInfo } from '../provider.js';

export type OpenRouterProviderOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
};

export class OpenRouterProvider implements AIProvider {
  private readonly provider: OpenAICompatibleProvider;

  constructor(options: OpenRouterProviderOptions) {
    if (!isFreeOpenRouterModel(options.model)) {
      throw new AIProviderError(
        'invalid_input',
        'OpenRouter model must be openrouter/free or a model ID ending in :free.',
      );
    }

    this.provider = new OpenAICompatibleProvider({
      providerName: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: options.apiKey,
      model: options.model,
      adaptRequest: (kind, request) => ({
        ...request,
        provider: {
          // Keep the request on free routes and avoid providers that skip requested parameters.
          allow_fallbacks: false,
          ...(kind === 'text' ? {} : { require_parameters: true }),
        },
      }),
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

  generateToolTurn(input: GenerateToolTurnInput): Promise<GenerateToolTurnOutput> {
    return this.provider.generateToolTurn(input);
  }
}

function isFreeOpenRouterModel(model: string): boolean {
  return model === 'openrouter/free' || model.endsWith(':free');
}
