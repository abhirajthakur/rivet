import type { RunCommandResult } from '@rivet/sandbox';
import type { AIToolDefinition } from '@rivet/ai';
import type {
  ApplyPatchResult,
  FileWriteResult,
  ListFilesOutput,
  ReadFileOutput,
  SearchCodeOutput,
} from '@rivet/tools';

export type AgentToolSet = {
  listFiles: (input: unknown) => Promise<ListFilesOutput>;
  readFile: (input: unknown) => Promise<ReadFileOutput>;
  searchCode: (input: unknown) => Promise<SearchCodeOutput>;
  writeFile: (input: unknown) => Promise<FileWriteResult>;
  applyPatch: (input: unknown) => Promise<ApplyPatchResult>;
  runCommand: (input: unknown, signal?: AbortSignal) => Promise<RunCommandResult>;
};

export interface ExecutableAgentTool extends AIToolDefinition {
  execute(input: unknown, signal?: AbortSignal): Promise<unknown>;
}

export function createTaskTools(tools: AgentToolSet): ExecutableAgentTool[] {
  return [
    {
      name: 'list_files',
      description: 'List repository files under a workspace-relative directory.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          maxDepth: { type: 'integer', minimum: 1, maximum: 8 },
          maxEntries: { type: 'integer', minimum: 1, maximum: 2000 },
        },
        additionalProperties: false,
      },
      execute: tools.listFiles,
    },
    {
      name: 'read_file',
      description: 'Read a UTF-8 repository file by workspace-relative path.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          maxBytes: { type: 'integer', minimum: 1, maximum: 262144 },
        },
        required: ['path'],
        additionalProperties: false,
      },
      execute: tools.readFile,
    },
    {
      name: 'search_code',
      description: 'Search repository text files for a literal query.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 200 },
          maxMatches: { type: 'integer', minimum: 1, maximum: 200 },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: tools.searchCode,
    },
    {
      name: 'write_file',
      description:
        'Create a workspace file or replace one using its previously read SHA-256 digest.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', minLength: 1 },
          content: { type: 'string' },
          expectedSha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      execute: tools.writeFile,
    },
    {
      name: 'apply_patch',
      description: 'Apply exact text replacements to a file matching its previously read digest.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', minLength: 1 },
          expectedSha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
          patches: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: {
              type: 'object',
              properties: { find: { type: 'string', minLength: 1 }, replace: { type: 'string' } },
              required: ['find', 'replace'],
              additionalProperties: false,
            },
          },
        },
        required: ['path', 'expectedSha256', 'patches'],
        additionalProperties: false,
      },
      execute: tools.applyPatch,
    },
    {
      name: 'run_command',
      description:
        'Run an argv command inside the isolated task container. Commands do not use a host shell or network.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'string' } },
          cwd: { type: 'string' },
          timeoutMs: { type: 'integer', minimum: 1, maximum: 600000 },
          maxOutputBytes: { type: 'integer', minimum: 1024, maximum: 524288 },
        },
        required: ['command'],
        additionalProperties: false,
      },
      execute: tools.runCommand,
    },
  ];
}
