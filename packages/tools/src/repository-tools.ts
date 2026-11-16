import type { Dirent, Stats } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  isWithinWorkspace,
  resolveWorkspacePath,
  WorkspaceToolError,
  type Workspace,
} from './workspace.js';

const DEFAULT_MAX_DEPTH = 4;
const MAX_ALLOWED_DEPTH = 8;
const DEFAULT_MAX_ENTRIES = 500;
const MAX_ALLOWED_ENTRIES = 2_000;
const DEFAULT_MAX_FILE_BYTES = 64 * 1024;
const MAX_ALLOWED_FILE_BYTES = 256 * 1024;
const MAX_SEARCH_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 128 * 1024;
const DEFAULT_MAX_MATCHES = 50;
const MAX_ALLOWED_MATCHES = 200;
const MAX_EXCERPT_LENGTH = 240;

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  'vendor',
]);

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.cts',
  '.go',
  '.html',
  '.java',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.mjs',
  '.mts',
  '.py',
  '.rs',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const TEXT_FILENAMES = new Set(['Dockerfile', 'Makefile', 'LICENSE', 'NOTICE']);

export interface ListFilesInput {
  readonly path?: string;
  readonly maxDepth?: number;
  readonly maxEntries?: number;
}

export interface ListFilesOutput {
  readonly files: readonly string[];
  readonly truncated: boolean;
}

export interface ReadFileInput {
  readonly path: string;
  readonly maxBytes?: number;
}

export interface ReadFileOutput {
  readonly path: string;
  readonly content: string;
  readonly sizeBytes: number;
  readonly truncated: boolean;
}

export interface SearchCodeInput {
  readonly query: string;
  readonly maxMatches?: number;
}

export interface CodeMatch {
  readonly path: string;
  readonly line: number;
  readonly excerpt: string;
}

export interface SearchCodeOutput {
  readonly matches: readonly CodeMatch[];
  readonly truncated: boolean;
}

export async function listFiles(
  workspace: Workspace,
  input: unknown = {},
): Promise<ListFilesOutput> {
  const options = parseListFilesInput(input);
  assertReadablePath(options.path ?? '.');
  const startPath = await resolveWorkspacePath(workspace, options.path ?? '.');
  const startStats = await statWorkspacePath(startPath);
  if (!startStats.isDirectory()) {
    throw new WorkspaceToolError('not_a_directory', 'The list path must name a directory.');
  }

  const files: string[] = [];
  let truncated = false;

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > options.maxDepth) {
      truncated = true;
      return;
    }
    if (files.length >= options.maxEntries) {
      truncated = true;
      return;
    }

    const entries = await readWorkspaceDirectory(directory);
    entries.sort((left, right) => compareNames(left.name, right.name));

    for (const entry of entries) {
      if (files.length >= options.maxEntries) {
        truncated = true;
        return;
      }

      if (entry.isSymbolicLink() || isSecretFilename(entry.name)) continue;

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await visit(absolutePath, depth + 1);
      } else if (entry.isFile()) {
        files.push(toWorkspaceRelativePath(workspace, absolutePath));
      }
    }
  };

  await visit(startPath, 0);
  return { files, truncated };
}

export async function readFile(workspace: Workspace, input: unknown): Promise<ReadFileOutput> {
  const options = parseReadFileInput(input);
  assertReadablePath(options.path);
  const absolutePath = await resolveWorkspacePath(workspace, options.path);
  const fileStats = await statWorkspacePath(absolutePath);
  if (!fileStats.isFile()) {
    throw new WorkspaceToolError('not_a_file', 'The read path must name a regular file.');
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
  let handle;
  try {
    handle = await open(absolutePath, 'r');
  } catch {
    throw new WorkspaceToolError('io_error', 'The requested workspace file could not be read.');
  }
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    const content = new TextDecoder().decode(buffer.subarray(0, bytesRead));
    return {
      path: toWorkspaceRelativePath(workspace, absolutePath),
      content,
      sizeBytes: fileStats.size,
      truncated: fileStats.size > bytesRead,
    };
  } finally {
    await handle.close();
  }
}

export async function searchCode(workspace: Workspace, input: unknown): Promise<SearchCodeOutput> {
  const options = parseSearchCodeInput(input);
  const listing = await listFiles(workspace, { maxDepth: MAX_ALLOWED_DEPTH, maxEntries: 1_000 });
  const query = options.query.toLowerCase();
  const matches: CodeMatch[] = [];
  let bytesReadTotal = 0;
  let truncated = listing.truncated;

  for (const filePath of listing.files) {
    if (!isTextFile(filePath)) continue;
    const remainingBytes = MAX_SEARCH_TOTAL_BYTES - bytesReadTotal;
    if (remainingBytes <= 0) {
      truncated = true;
      break;
    }

    const result = await readFile(workspace, {
      path: filePath,
      maxBytes: Math.min(MAX_SEARCH_FILE_BYTES, remainingBytes),
    });
    bytesReadTotal += Math.min(result.sizeBytes, Math.min(MAX_SEARCH_FILE_BYTES, remainingBytes));
    truncated ||= result.truncated;

    const lines = result.content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line?.toLowerCase().includes(query)) {
        matches.push({
          path: filePath,
          line: index + 1,
          excerpt: line.slice(0, MAX_EXCERPT_LENGTH),
        });
        if (matches.length >= options.maxMatches) {
          return { matches, truncated: true };
        }
      }
    }
  }

  return { matches, truncated };
}

function parseListFilesInput(input: unknown): Required<ListFilesInput> {
  const record = asObject(input, ['path', 'maxDepth', 'maxEntries']);
  const requestedPath = optionalString(record, 'path');
  const maxDepth = optionalInteger(record, 'maxDepth', MAX_ALLOWED_DEPTH);
  const maxEntries = optionalInteger(record, 'maxEntries', MAX_ALLOWED_ENTRIES);

  return {
    path: requestedPath ?? '.',
    maxDepth: maxDepth ?? DEFAULT_MAX_DEPTH,
    maxEntries: maxEntries ?? DEFAULT_MAX_ENTRIES,
  };
}

function parseReadFileInput(input: unknown): Required<ReadFileInput> {
  const record = asObject(input, ['path', 'maxBytes']);
  const requestedPath = requiredString(record, 'path');
  const maxBytes = optionalInteger(record, 'maxBytes', MAX_ALLOWED_FILE_BYTES);
  return { path: requestedPath, maxBytes: maxBytes ?? DEFAULT_MAX_FILE_BYTES };
}

function parseSearchCodeInput(input: unknown): Required<SearchCodeInput> {
  const record = asObject(input, ['query', 'maxMatches']);
  const query = requiredString(record, 'query');
  if (query.length > 200) {
    throw new WorkspaceToolError('invalid_input', 'Search query must be 200 characters or fewer.');
  }

  const maxMatches = optionalInteger(record, 'maxMatches', MAX_ALLOWED_MATCHES);
  return { query, maxMatches: maxMatches ?? DEFAULT_MAX_MATCHES };
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
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 1 || value > maximum) {
    throw new WorkspaceToolError(
      'invalid_input',
      `Tool input field "${key}" must be an integer from 1 to ${maximum}.`,
    );
  }
  return value;
}

function isSecretFilename(filename: string): boolean {
  return filename === '.env' || filename.startsWith('.env.');
}

function assertReadablePath(relativePath: string): void {
  const segments = relativePath.split('/');
  if (segments.some((segment) => IGNORED_DIRECTORIES.has(segment) || isSecretFilename(segment))) {
    throw new WorkspaceToolError('path_outside_workspace', 'This workspace path is not readable.');
  }
}

async function statWorkspacePath(absolutePath: string): Promise<Stats> {
  try {
    return await stat(absolutePath);
  } catch {
    throw new WorkspaceToolError('io_error', 'The requested workspace path could not be read.');
  }
}

async function readWorkspaceDirectory(absolutePath: string): Promise<Dirent[]> {
  try {
    return await readdir(absolutePath, { encoding: 'utf8', withFileTypes: true });
  } catch {
    throw new WorkspaceToolError(
      'io_error',
      'The requested workspace directory could not be read.',
    );
  }
}

function isTextFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return TEXT_FILENAMES.has(basename) || TEXT_EXTENSIONS.has(path.extname(basename).toLowerCase());
}

function toWorkspaceRelativePath(workspace: Workspace, absolutePath: string): string {
  if (!isWithinWorkspace(workspace, absolutePath)) {
    throw new WorkspaceToolError(
      'path_outside_workspace',
      'Only paths resolving inside the workspace are allowed.',
    );
  }
  return path.relative(workspace.rootDirectory, absolutePath).split(path.sep).join('/');
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
