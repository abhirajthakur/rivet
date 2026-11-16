export type SandboxErrorCode =
  'invalid_input' | 'invalid_workspace' | 'runtime_unavailable' | 'runtime_error';

export class SandboxError extends Error {
  constructor(
    readonly code: SandboxErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SandboxError';
  }
}
