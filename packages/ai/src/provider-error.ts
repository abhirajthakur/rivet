export type AIProviderErrorCode =
  'invalid_input' | 'request_failed' | 'invalid_response' | 'invalid_structured_output';

export class AIProviderError extends Error {
  code: AIProviderErrorCode;

  constructor(code: AIProviderErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AIProviderError';
    this.code = code;
  }
}
