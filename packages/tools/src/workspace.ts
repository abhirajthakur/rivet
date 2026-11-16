import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export interface Workspace {
  readonly rootDirectory: string;
}

export type WorkspaceToolErrorCode =
  'invalid_input' | 'path_outside_workspace' | 'not_a_file' | 'not_a_directory' | 'io_error';

export class WorkspaceToolError extends Error {
  constructor(
    readonly code: WorkspaceToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceToolError';
  }
}

export async function openWorkspace(rootDirectory: string): Promise<Workspace> {
  try {
    const canonicalRoot = await realpath(rootDirectory);
    const rootStats = await stat(canonicalRoot);
    if (!rootStats.isDirectory()) {
      throw new WorkspaceToolError('not_a_directory', 'Workspace root must be a directory.');
    }

    return { rootDirectory: canonicalRoot };
  } catch (error: unknown) {
    if (error instanceof WorkspaceToolError) throw error;
    throw new WorkspaceToolError('io_error', 'Unable to open the workspace directory.');
  }
}

export async function resolveWorkspacePath(
  workspace: Workspace,
  relativePath: string,
): Promise<string> {
  if (relativePath.includes('\0') || path.isAbsolute(relativePath) || relativePath.includes('\\')) {
    throw new WorkspaceToolError(
      'path_outside_workspace',
      'Only relative paths inside the workspace are allowed.',
    );
  }

  const segments = relativePath.split('/');
  if (segments.includes('..')) {
    throw new WorkspaceToolError(
      'path_outside_workspace',
      'Only relative paths inside the workspace are allowed.',
    );
  }

  const candidate = path.resolve(workspace.rootDirectory, relativePath || '.');
  if (!isWithin(workspace.rootDirectory, candidate)) {
    throw new WorkspaceToolError(
      'path_outside_workspace',
      'Only relative paths inside the workspace are allowed.',
    );
  }

  try {
    const canonicalPath = await realpath(candidate);
    if (!isWithin(workspace.rootDirectory, canonicalPath)) {
      throw new WorkspaceToolError(
        'path_outside_workspace',
        'Only paths resolving inside the workspace are allowed.',
      );
    }

    return canonicalPath;
  } catch (error: unknown) {
    if (error instanceof WorkspaceToolError) throw error;
    throw new WorkspaceToolError('io_error', 'The requested workspace path could not be read.');
  }
}

export function isWithinWorkspace(workspace: Workspace, candidate: string): boolean {
  return isWithin(workspace.rootDirectory, candidate);
}

function isWithin(rootDirectory: string, candidate: string): boolean {
  const relative = path.relative(rootDirectory, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
}
