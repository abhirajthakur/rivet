import { createHash, randomUUID } from 'node:crypto';
import { link, open, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { parseApplyPatchInput, parseWriteFileInput } from './tool-input.js';
import { assertWorkspacePathAllowed } from './repository-tools.js';
import { resolveWorkspaceTarget, WorkspaceToolError, type Workspace } from './workspace.js';

const MAX_EDITABLE_FILE_BYTES = 1024 * 1024;

export interface FileWriteResult {
  readonly path: string;
  readonly created: boolean;
  readonly bytesWritten: number;
  readonly sha256: string;
}

export interface ApplyPatchResult extends FileWriteResult {
  readonly patchesApplied: number;
}

export async function writeFile(workspace: Workspace, input: unknown): Promise<FileWriteResult> {
  const options = parseWriteFileInput(input);
  assertWorkspacePathAllowed(options.path);

  const target = await resolveWorkspaceTarget(workspace, options.path);
  const expectedSha256 = options.expectedSha256?.toLowerCase();
  if (target.exists && expectedSha256 === undefined) {
    throw new WorkspaceToolError(
      'invalid_input',
      'expectedSha256 is required when replacing an existing file.',
    );
  }
  if (!target.exists && expectedSha256 !== undefined) {
    throw new WorkspaceToolError(
      'concurrent_modification',
      'The file was created after the requested edit was prepared.',
    );
  }

  if (target.exists) {
    const currentFile = await readEditableFile(target.absolutePath);
    if (currentFile.sha256 !== expectedSha256) {
      throw new WorkspaceToolError(
        'concurrent_modification',
        'The file changed since it was read; read it again before editing.',
      );
    }
  }

  const contentBytes = Buffer.from(options.content, 'utf8');
  const sha256 = hash(contentBytes);
  await writeAtomically(
    target.absolutePath,
    contentBytes,
    target.exists,
    expectedSha256,
    target.mode,
  );

  return {
    path: options.path,
    created: !target.exists,
    bytesWritten: contentBytes.byteLength,
    sha256,
  };
}

export async function applyPatch(workspace: Workspace, input: unknown): Promise<ApplyPatchResult> {
  const options = parseApplyPatchInput(input);
  assertWorkspacePathAllowed(options.path);

  const target = await resolveWorkspaceTarget(workspace, options.path);
  if (!target.exists) {
    throw new WorkspaceToolError('not_a_file', 'The patch path must name an existing file.');
  }

  const currentFile = await readEditableFile(target.absolutePath);
  if (currentFile.sha256 !== options.expectedSha256.toLowerCase()) {
    throw new WorkspaceToolError(
      'concurrent_modification',
      'The file changed since it was read; read it again before applying a patch.',
    );
  }

  let updatedContent = currentFile.content;
  for (const patch of options.patches) {
    const firstMatch = updatedContent.indexOf(patch.find);
    if (firstMatch < 0 || updatedContent.indexOf(patch.find, firstMatch + 1) >= 0) {
      throw new WorkspaceToolError(
        'patch_failed',
        'Each patch must match exactly one location in the current file.',
      );
    }

    updatedContent =
      updatedContent.slice(0, firstMatch) +
      patch.replace +
      updatedContent.slice(firstMatch + patch.find.length);
  }

  const updatedBytes = Buffer.from(updatedContent, 'utf8');
  if (updatedBytes.byteLength > MAX_EDITABLE_FILE_BYTES) {
    throw new WorkspaceToolError('file_too_large', 'Patched file exceeds the 1 MiB edit limit.');
  }

  const result = await writeFile(workspace, {
    path: options.path,
    content: updatedContent,
    expectedSha256: options.expectedSha256,
  });
  return { ...result, patchesApplied: options.patches.length };
}

async function readEditableFile(
  absolutePath: string,
): Promise<{ readonly content: string; readonly sha256: string }> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(absolutePath, 'r');
    const fileStats = await handle.stat();
    if (!fileStats.isFile()) {
      throw new WorkspaceToolError('not_a_file', 'The edit path must name a regular file.');
    }
    if (fileStats.size > MAX_EDITABLE_FILE_BYTES) {
      throw new WorkspaceToolError('file_too_large', 'File exceeds the 1 MiB edit limit.');
    }

    const bytes = Buffer.alloc(fileStats.size);
    const { bytesRead } = await handle.read(bytes, 0, fileStats.size, 0);
    if (bytesRead !== fileStats.size) {
      throw new WorkspaceToolError(
        'concurrent_modification',
        'The file changed while it was being read; read it again before editing.',
      );
    }

    const content = bytes.toString('utf8');
    if (!Buffer.from(content, 'utf8').equals(bytes)) {
      throw new WorkspaceToolError(
        'invalid_text_file',
        'Only valid UTF-8 text files can be modified by this tool.',
      );
    }
    return { content, sha256: hash(bytes) };
  } catch (error: unknown) {
    if (error instanceof WorkspaceToolError) throw error;
    throw new WorkspaceToolError('io_error', 'The requested workspace file could not be read.');
  } finally {
    await handle?.close();
  }
}

async function writeAtomically(
  targetPath: string,
  content: Buffer,
  targetExists: boolean,
  expectedSha256: string | undefined,
  mode: number,
): Promise<void> {
  const temporaryPath = path.join(path.dirname(targetPath), `.rivet-${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporaryPath, 'wx', mode);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;

    if (targetExists) {
      const latestFile = await readEditableFile(targetPath);
      if (latestFile.sha256 !== expectedSha256) {
        throw new WorkspaceToolError(
          'concurrent_modification',
          'The file changed during the edit; read it again before retrying.',
        );
      }
      await rename(temporaryPath, targetPath);
    } else {
      await link(temporaryPath, targetPath);
      await unlink(temporaryPath);
    }
  } catch (error: unknown) {
    if (error instanceof WorkspaceToolError) throw error;
    if (isErrorCode(error, 'EEXIST')) {
      throw new WorkspaceToolError(
        'concurrent_modification',
        'The new file path was created during the edit; read it before replacing it.',
      );
    }
    throw new WorkspaceToolError('io_error', 'The workspace file could not be written.');
  } finally {
    await handle?.close();
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function hash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
