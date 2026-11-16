export type SandboxErrorCode =
  'invalid_input' | 'invalid_workspace' | 'runtime_unavailable' | 'runtime_error';

export class SandboxError extends Error {
  code: SandboxErrorCode;

  constructor(code: SandboxErrorCode, message: string) {
    super(message);
    this.name = 'SandboxError';
    this.code = code;
  }
}
