import { WorkspaceToolError } from './workspace.js';

export interface ListFilesInput {
  readonly path?: string;
  readonly maxDepth?: number;
  readonly maxEntries?: number;
}

export interface ReadFileInput {
  readonly path: string;
  readonly maxBytes?: number;
}

export interface SearchCodeInput {
  readonly query: string;
  readonly maxMatches?: number;
}

export interface WriteFileInput {
  readonly path: string;
  readonly content: string;
  readonly expectedSha256?: string;
}

export interface TextPatch {
  readonly find: string;
  readonly replace: string;
}

export interface ApplyPatchInput {
  readonly path: string;
  readonly expectedSha256: string;
  readonly patches: readonly TextPatch[];
}

const MAX_ALLOWED_DEPTH = 8;
const MAX_ALLOWED_ENTRIES = 2_000;
const MAX_ALLOWED_FILE_BYTES = 256 * 1024;
const MAX_ALLOWED_MATCHES = 200;
const MAX_EDITABLE_FILE_BYTES = 1024 * 1024;
const MAX_PATCH_COUNT = 100;
const MAX_PATCH_TEXT_BYTES = 32 * 1024;

export function parseListFilesInput(input: unknown): Required<ListFilesInput> {
  const record = asObject(input, ['path', 'maxDepth', 'maxEntries']);
  const requestedPath = optionalString(record, 'path');
  const maxDepth = optionalInteger(record, 'maxDepth', MAX_ALLOWED_DEPTH);
  const maxEntries = optionalInteger(record, 'maxEntries', MAX_ALLOWED_ENTRIES);

  return {
    path: requestedPath ?? '.',
    maxDepth: maxDepth ?? 4,
    maxEntries: maxEntries ?? 500,
  };
}

export function parseReadFileInput(input: unknown): Required<ReadFileInput> {
  const record = asObject(input, ['path', 'maxBytes']);
  const requestedPath = requiredString(record, 'path');
  const maxBytes = optionalInteger(record, 'maxBytes', MAX_ALLOWED_FILE_BYTES);
  return { path: requestedPath, maxBytes: maxBytes ?? 64 * 1024 };
}

export function parseSearchCodeInput(input: unknown): Required<SearchCodeInput> {
  const record = asObject(input, ['query', 'maxMatches']);
  const query = requiredString(record, 'query');
  if (query.length > 200) {
    throw new WorkspaceToolError('invalid_input', 'Search query must be 200 characters or fewer.');
  }

  const maxMatches = optionalInteger(record, 'maxMatches', MAX_ALLOWED_MATCHES);
  return { query, maxMatches: maxMatches ?? 50 };
}

export function parseWriteFileInput(input: unknown): WriteFileInput {
  const record = asObject(input, ['path', 'content', 'expectedSha256']);
  const path = requiredString(record, 'path');
  const content = stringField(record, 'content', true);
  const expectedSha256 = optionalString(record, 'expectedSha256');
  if (expectedSha256 !== undefined) validateSha256(expectedSha256);
  if (Buffer.byteLength(content, 'utf8') > MAX_EDITABLE_FILE_BYTES) {
    throw new WorkspaceToolError('file_too_large', 'File content exceeds the 1 MiB write limit.');
  }

  return expectedSha256 === undefined ? { path, content } : { path, content, expectedSha256 };
}

export function parseApplyPatchInput(input: unknown): ApplyPatchInput {
  const record = asObject(input, ['path', 'expectedSha256', 'patches']);
  const path = requiredString(record, 'path');
  const expectedSha256 = requiredString(record, 'expectedSha256');
  validateSha256(expectedSha256);

  const patchesValue = record['patches'];
  if (
    !Array.isArray(patchesValue) ||
    patchesValue.length === 0 ||
    patchesValue.length > MAX_PATCH_COUNT
  ) {
    throw new WorkspaceToolError(
      'invalid_input',
      `Tool input field "patches" must contain 1 to ${MAX_PATCH_COUNT} edits.`,
    );
  }

  let totalPatchBytes = 0;
  const patches = patchesValue.map((patchValue): TextPatch => {
    const patch = asObject(patchValue, ['find', 'replace']);
    const find = requiredString(patch, 'find');
    const replace = stringField(patch, 'replace', true);
    if (
      Buffer.byteLength(find, 'utf8') > MAX_PATCH_TEXT_BYTES ||
      Buffer.byteLength(replace, 'utf8') > MAX_PATCH_TEXT_BYTES
    ) {
      throw new WorkspaceToolError('invalid_input', 'Each patch field must be 32 KiB or smaller.');
    }
    totalPatchBytes += Buffer.byteLength(find, 'utf8') + Buffer.byteLength(replace, 'utf8');
    if (totalPatchBytes > MAX_EDITABLE_FILE_BYTES) {
      throw new WorkspaceToolError('file_too_large', 'Patch content exceeds the 1 MiB edit limit.');
    }
    return { find, replace };
  });

  return { path, expectedSha256, patches };
}

function asObject(input: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new WorkspaceToolError('invalid_input', 'Tool input must be an object.');
  }

  const record = input as Record<string, unknown>;
  const unknownKey = Object.keys(record).find((key) => !allowedKeys.includes(key));
  if (unknownKey) {
    throw new WorkspaceToolError('invalid_input', `Unknown tool input field: ${unknownKey}.`);
  }
  return record;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WorkspaceToolError(
      'invalid_input',
      `Tool input field "${key}" must be a non-empty string.`,
    );
  }
  return value;
}

function stringField(record: Record<string, unknown>, key: string, allowEmpty: boolean): string {
  const value = record[key];
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new WorkspaceToolError(
      'invalid_input',
      `Tool input field "${key}" must be a string${allowEmpty ? '' : ' and not empty'}.`,
    );
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new WorkspaceToolError('invalid_input', `Tool input field "${key}" must be a string.`);
  }
  return value;
}

function optionalInteger(
  record: Record<string, unknown>,
  key: string,
  maximum: number,
): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new WorkspaceToolError(
      'invalid_input',
      `Tool input field "${key}" must be an integer from 1 to ${maximum}.`,
    );
  }
  return value;
}

function validateSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/iu.test(value)) {
    throw new WorkspaceToolError(
      'invalid_input',
      'expectedSha256 must be a 64-character SHA-256 hex digest.',
    );
  }
}
