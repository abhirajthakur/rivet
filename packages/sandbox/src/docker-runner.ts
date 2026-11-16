import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseRunCommandInput, type ParsedRunCommandInput } from './command-input.js';
import { SandboxError } from './errors.js';
import { BoundedOutputCapture } from './output-capture.js';
import { isWithin, toPosix } from './path-helpers.js';

const IMAGE = 'rivet-sandbox:node24';

export interface RunCommandInput {
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface RunCommandResult {
  readonly command: readonly string[];
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly outputTruncated: boolean;
}

export interface DockerSandboxOptions {
  readonly workspacePath: string;
  readonly runtimePath?: string;
}

interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export class DockerSandboxRunner {
  private constructor(
    private readonly workspaceRoot: string,
    private readonly runtimePath: string,
  ) {}

  static async create(options: DockerSandboxOptions): Promise<DockerSandboxRunner> {
    let canonicalRoot: string;
    try {
      canonicalRoot = await realpath(options.workspacePath);
      const rootStats = await stat(canonicalRoot);
      if (!rootStats.isDirectory() || canonicalRoot.includes(',')) {
        throw new SandboxError(
          'invalid_workspace',
          'Workspace must be a directory with a Docker-compatible path.',
        );
      }
    } catch (error: unknown) {
      if (error instanceof SandboxError) throw error;
      throw new SandboxError('invalid_workspace', 'Unable to open the task workspace directory.');
    }

    return new DockerSandboxRunner(canonicalRoot, options.runtimePath ?? 'docker');
  }

  async runCommand(input: unknown, signal?: AbortSignal): Promise<RunCommandResult> {
    const options = parseRunCommandInput(input);
    const containerCwd = await this.resolveContainerCwd(options.cwd);
    const startedAt = Date.now();

    if (signal?.aborted) {
      return emptyResult(options, startedAt, { cancelled: true });
    }

    const containerName = `rivet-${randomUUID()}`;
    const capture = new BoundedOutputCapture(options.maxOutputBytes);
    const child = spawn(
      this.runtimePath,
      this.buildArguments(options, containerName, containerCwd),
      {
        cwd: this.workspaceRoot,
        env: dockerClientEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    child.stdout.on('data', (chunk: Buffer) => capture.append('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => capture.append('stderr', chunk));

    let timedOut = false;
    let cancelled = false;
    let processStarted = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const terminate = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
    };

    const abortHandler = (): void => {
      cancelled = true;
      terminate();
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
    signal?.addEventListener('abort', abortHandler, { once: true });

    try {
      const processResult = await waitForProcess(child, () => {
        processStarted = true;
      });
      return {
        command: options.command,
        exitCode: processResult.exitCode,
        timedOut,
        cancelled,
        durationMs: Date.now() - startedAt,
        stdout: capture.stdout,
        stderr: capture.stderr,
        outputTruncated: capture.truncated,
      };
    } catch (error: unknown) {
      if (isErrorCode(error, 'ENOENT')) {
        throw new SandboxError(
          'runtime_unavailable',
          'Docker is not installed or is not available on the worker PATH.',
        );
      }
      throw new SandboxError('runtime_error', 'The Docker sandbox could not start.');
    } finally {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener('abort', abortHandler);
      if (processStarted && (timedOut || cancelled)) {
        await removeContainer(this.runtimePath, containerName, dockerClientEnvironment());
      }
    }
  }

  private async resolveContainerCwd(relativePath: string): Promise<string> {
    if (
      relativePath.includes('\0') ||
      path.isAbsolute(relativePath) ||
      relativePath.includes('\\') ||
      relativePath.split('/').includes('..')
    ) {
      throw new SandboxError('invalid_input', 'Command cwd must stay inside the workspace.');
    }

    let canonicalCwd: string;
    try {
      canonicalCwd = await realpath(path.resolve(this.workspaceRoot, relativePath || '.'));
      const cwdStats = await stat(canonicalCwd);
      if (!isWithin(this.workspaceRoot, canonicalCwd) || !cwdStats.isDirectory()) {
        throw new SandboxError('invalid_input', 'Command cwd must be a workspace directory.');
      }
    } catch (error: unknown) {
      if (error instanceof SandboxError) throw error;
      throw new SandboxError(
        'invalid_input',
        'Command cwd must be an existing workspace directory.',
      );
    }

    const relativeCwd = path.relative(this.workspaceRoot, canonicalCwd);
    return relativeCwd.length === 0 ? '/workspace' : `/workspace/${toPosix(relativeCwd)}`;
  }

  private buildArguments(
    options: ParsedRunCommandInput,
    containerName: string,
    containerCwd: string,
  ): string[] {
    const userId = currentNonRootUserId();
    return [
      'run',
      '--rm',
      '--pull=never',
      `--name=${containerName}`,
      '--network=none',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=128',
      '--memory=2g',
      '--memory-swap=2g',
      '--cpus=2',
      '--ulimit=nofile=1024:1024',
      '--ulimit=fsize=67108864:67108864',
      `--user=${userId}:${currentGroupId()}`,
      '--env=TMPDIR=/tmp',
      '--env=CI=true',
      '--env=NODE_ENV=test',
      '--tmpfs=/tmp:rw,nosuid,nodev,size=256m,mode=1777',
      `--mount=type=bind,source=${this.workspaceRoot},target=/workspace`,
      `--workdir=${containerCwd}`,
      IMAGE,
      ...options.command,
    ];
  }
}

function waitForProcess(child: ChildProcess, onStart: () => void): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    child.once('spawn', onStart);
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });
}

async function removeContainer(
  runtimePath: string,
  containerName: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn(runtimePath, ['rm', '--force', containerName], {
      env: environment,
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5_000);
    child.once('error', () => {
      clearTimeout(timer);
      resolve();
    });
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function dockerClientEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    HOME: process.env['HOME'] ?? '/tmp',
  };
  for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function currentNonRootUserId(): number {
  const userId = typeof process.getuid === 'function' ? process.getuid() : 1000;
  return userId === 0 ? 1000 : userId;
}

function currentGroupId(): number {
  const groupId = typeof process.getgid === 'function' ? process.getgid() : 1000;
  return groupId === 0 ? 1000 : groupId;
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function emptyResult(
  options: ParsedRunCommandInput,
  startedAt: number,
  result: { readonly cancelled?: boolean; readonly timedOut?: boolean },
): RunCommandResult {
  return {
    command: options.command,
    exitCode: null,
    timedOut: result.timedOut ?? false,
    cancelled: result.cancelled ?? false,
    durationMs: Date.now() - startedAt,
    stdout: '',
    stderr: '',
    outputTruncated: false,
  };
}
