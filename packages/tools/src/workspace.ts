import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export interface Workspace {
  readonly rootDirectory: string;
}

export type WorkspaceToolErrorCode =
  | 'invalid_input'
  | 'path_outside_workspace'
  | 'not_a_file'
  | 'not_a_directory'
  | 'file_too_large'
  | 'concurrent_modification'
  | 'invalid_text_file'
  | 'patch_failed'
  | 'io_error';

export interface WorkspaceTarget {
  readonly absolutePath: string;
  readonly exists: boolean;
  readonly mode: number;
}

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
  assertRelativeWorkspacePath(relativePath);

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

export async function resolveWorkspaceTarget(
  workspace: Workspace,
  relativePath: string,
): Promise<WorkspaceTarget> {
  assertRelativeWorkspacePath(relativePath);
  const filename = path.posix.basename(relativePath);
  if (filename === '.' || filename === '/' || filename.length === 0) {
    throw new WorkspaceToolError('invalid_input', 'A file path is required.');
  }

  const parentRelativePath = path.posix.dirname(relativePath);
  const parentPath = await resolveWorkspacePath(workspace, parentRelativePath || '.');
  let parentStats;
  try {
    parentStats = await stat(parentPath);
  } catch {
    throw new WorkspaceToolError(
      'io_error',
      'The workspace parent directory could not be accessed.',
    );
  }
  if (!parentStats.isDirectory()) {
    throw new WorkspaceToolError('not_a_directory', 'The parent path must name a directory.');
  }

  const candidate = path.join(parentPath, filename);
  try {
    const candidateStats = await lstat(candidate);
    if (candidateStats.isSymbolicLink()) {
      throw new WorkspaceToolError(
        'path_outside_workspace',
        'Symbolic links cannot be used as write targets.',
      );
    }
    if (!candidateStats.isFile()) {
      throw new WorkspaceToolError('not_a_file', 'The write path must name a regular file.');
    }

    const canonicalPath = await realpath(candidate);
    if (!isWithin(workspace.rootDirectory, canonicalPath)) {
      throw new WorkspaceToolError(
        'path_outside_workspace',
        'Only paths resolving inside the workspace are allowed.',
      );
    }

    return {
      absolutePath: canonicalPath,
      exists: true,
      mode: candidateStats.mode & 0o777,
    };
  } catch (error: unknown) {
    if (error instanceof WorkspaceToolError) throw error;
    if (isNotFoundError(error)) {
      return { absolutePath: candidate, exists: false, mode: 0o644 };
    }
    throw new WorkspaceToolError('io_error', 'The requested workspace path could not be accessed.');
  }
}

export function assertRelativeWorkspacePath(relativePath: string): void {
  if (relativePath.includes('\0') || path.isAbsolute(relativePath) || relativePath.includes('\\')) {
    throw new WorkspaceToolError(
      'path_outside_workspace',
      'Only relative paths inside the workspace are allowed.',
    );
  }

  if (relativePath.split('/').includes('..')) {
    throw new WorkspaceToolError(
      'path_outside_workspace',
      'Only relative paths inside the workspace are allowed.',
    );
  }
}

export function isWithinWorkspace(workspace: Workspace, candidate: string): boolean {
  return isWithin(workspace.rootDirectory, candidate);
}

function isWithin(rootDirectory: string, candidate: string): boolean {
  const relative = path.relative(rootDirectory, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
