import { SandboxError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_OUTPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_COMMAND_ARGUMENTS = 64;
const MAX_COMMAND_BYTES = 16 * 1024;

export interface ParsedRunCommandInput {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export function parseRunCommandInput(input: unknown): ParsedRunCommandInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new SandboxError('invalid_input', 'run_command input must be an object.');
  }

  const record = input as Record<string, unknown>;
  const allowedKeys = new Set(['command', 'cwd', 'timeoutMs', 'maxOutputBytes']);
  const unknownKey = Object.keys(record).find((key) => !allowedKeys.has(key));
  if (unknownKey) {
    throw new SandboxError('invalid_input', `Unknown run_command field: ${unknownKey}.`);
  }

  const commandValue = record['command'];
  if (
    !Array.isArray(commandValue) ||
    commandValue.length === 0 ||
    commandValue.length > MAX_COMMAND_ARGUMENTS ||
    commandValue.some((argument) => typeof argument !== 'string' || argument.includes('\0')) ||
    typeof commandValue[0] !== 'string' ||
    commandValue[0].trim().length === 0
  ) {
    throw new SandboxError(
      'invalid_input',
      `command must be an argv array with 1 to ${MAX_COMMAND_ARGUMENTS} string arguments.`,
    );
  }
  const command = commandValue as string[];
  if (
    command.reduce((length, argument) => length + Buffer.byteLength(argument), 0) >
    MAX_COMMAND_BYTES
  ) {
    throw new SandboxError('invalid_input', 'Command arguments exceed the 16 KiB limit.');
  }

  const cwdValue = record['cwd'];
  if (cwdValue !== undefined && typeof cwdValue !== 'string') {
    throw new SandboxError('invalid_input', 'cwd must be a string.');
  }

  return {
    command,
    cwd: (cwdValue as string | undefined) ?? '.',
    timeoutMs: boundedInteger(record['timeoutMs'], DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, 'timeoutMs'),
    maxOutputBytes: boundedInteger(
      record['maxOutputBytes'],
      DEFAULT_OUTPUT_BYTES,
      MAX_OUTPUT_BYTES,
      'maxOutputBytes',
      1024,
    ),
  };
}

function boundedInteger(
  value: unknown,
  defaultValue: number,
  maximum: number,
  field: string,
  minimum = 1,
): number {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new SandboxError(
      'invalid_input',
      `${field} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}
