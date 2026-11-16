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

const MAX_ALLOWED_DEPTH = 8;
const MAX_ALLOWED_ENTRIES = 2_000;
const MAX_ALLOWED_FILE_BYTES = 256 * 1024;
const MAX_ALLOWED_MATCHES = 200;

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
