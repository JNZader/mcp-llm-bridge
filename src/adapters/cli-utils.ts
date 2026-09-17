/**
 * CLI utility helpers for subprocess execution.
 */

import { execFileSync, execFile, spawn, type ChildProcess } from 'node:child_process';
import { sanitizeErrorMessage } from '../security/sanitize.js';
import { createGenerationAbortError } from '../core/generation-cancellation.js';

const CLI_TERMINATION_GRACE_MS = 1_000;

/**
 * Default timeout for CLI subprocess (2 minutes).
 */
export const DEFAULT_CLI_TIMEOUT = 120_000;

/**
 * Default max buffer for stdout/stderr (10MB).
 */
export const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Copilot CLI requires `-p <text>` (no stdin). Prompts larger than this are
 * refused instead of interpolated onto argv. 37k legal RAG payloads must
 * never take this path — pin `opencode-cli` (stdin) instead.
 */
export const MAX_ARGV_PROMPT_CHARS = 4_096;
export const MAX_COPILOT_ARGV_PROMPT_CHARS = MAX_ARGV_PROMPT_CHARS;

/** Ignore tiny tokens (`json`, model ids) when guarding argv against prompt leaks. */
const ARGV_PROMPT_LEAK_MIN_CHARS = 64;

/**
 * Refuse to spawn a CLI whose argv already contains the prompt or system
 * text. Large legal RAG payloads must travel on stdin or a file, never `-p`.
 */
export function assertPromptNotOnArgv(
  command: string,
  args: readonly string[],
  bodies: readonly (string | undefined)[],
): void {
  for (const body of bodies) {
    if (!body || body.length < ARGV_PROMPT_LEAK_MIN_CHARS) {
      continue;
    }
    const needle = body.slice(0, ARGV_PROMPT_LEAK_MIN_CHARS);
    for (const arg of args) {
      if (arg === body || arg.includes(needle)) {
        throw new Error(
          `${command} refused to put prompt/system on argv (${body.length} chars). Use stdin or a file.`,
        );
      }
    }
  }
}

/**
 * Check if a CLI command is available using execFileSync (sync version).
 *
 * @param command - The CLI binary name (e.g., 'opencode', 'claude')
 * @param args - Arguments for version check (e.g., ['--version'])
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @returns true if the command is available
 */
export function isCliAvailable(command: string, args: string[] = ['--version'], timeout = 5000): boolean {
  try {
    execFileSync(command, args, {
      timeout,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Async version of isCliAvailable that doesn't block the event loop.
 *
 * @param command - The CLI binary name
 * @param args - Arguments for version check
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @returns Promise<true> if available, Promise<false> otherwise
 */
export async function isCliAvailableAsync(
  command: string,
  args: string[] = ['--version'],
  timeout = 5000,
): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const child = execFile(command, args, { timeout } as any);

      child.on('close', (code: number | null) => {
        if (code === 0) resolve();
        else reject(new Error(`Exit code ${code}`));
      });
      child.on('error', reject);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute a CLI command synchronously using execFileSync.
 * This is the safer alternative to execSync with string interpolation.
 *
 * @param command - The CLI binary name
 * @param args - Command arguments array (each arg is a separate element)
 * @param options - Execution options
 * @returns stdout as string
 */
export function execCliSync(
  command: string,
  args: string[],
  options: {
    input?: string;
    timeout?: number;
    maxBuffer?: number;
    env?: Record<string, string>;
  } = {},
): string {
  const { input, timeout = DEFAULT_CLI_TIMEOUT, maxBuffer = DEFAULT_MAX_BUFFER, env } = options;

  return execFileSync(command, args, {
    input,
    timeout,
    maxBuffer,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: env ?? process.env as Record<string, string>,
  });
}

/**
 * Error from async CLI execution with stdout/stderr attached.
 */
export interface CliError extends Error {
  kind: CliFailureKind;
  code?: string;
  stdout?: string;
  stderr?: string;
}

export const CLI_FAILURE_KIND = {
  ABORTED: 'aborted',
  EXIT: 'exit',
  TERMINATION: 'termination',
  PROCESS_ERROR: 'process_error',
} as const;

const CLI_TERMINATION_CAUSE = {
  CALLER_ABORT: 'caller_abort',
  DEADLINE: 'deadline',
} as const;

type CliTerminationCause = (typeof CLI_TERMINATION_CAUSE)[keyof typeof CLI_TERMINATION_CAUSE];

export type CliFailureKind = (typeof CLI_FAILURE_KIND)[keyof typeof CLI_FAILURE_KIND];

/**
 * Execute a CLI command asynchronously using spawn (detached process group).
 * Uses array accumulation to avoid O(n²) string concatenation.
 *
 * @param command - The CLI binary name
 * @param args - Command arguments array
 * @param options - Execution options
 * @returns Object with stdout and stderr
 */
export async function execCliAsync(
  command: string,
  args: string[],
  options: {
    input?: string;
    timeout?: number;
    maxBuffer?: number;
    env?: Record<string, string>;
    signal?: AbortSignal;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  const { input, timeout = DEFAULT_CLI_TIMEOUT, maxBuffer = DEFAULT_MAX_BUFFER, env, signal } = options;

  if (!Number.isSafeInteger(timeout) || timeout < 0) {
    throw new RangeError('CLI timeout must be a non-negative safe integer');
  }

  if (signal?.aborted) {
    const error = createGenerationAbortError() as CliError;
    error.kind = CLI_FAILURE_KIND.ABORTED;
    throw error;
  }

  return new Promise((resolve, reject) => {
    // Use array accumulation instead of string concatenation for O(n) complexity
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];
    let recordedError: Error | undefined;
    let closed = false;
    let directChildExited = false;
    let terminationCause: CliTerminationCause | undefined;
    let deadlineTimer: NodeJS.Timeout | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const recordProcessError = (error: Error): void => {
      recordedError ??= error;
    };

    const rejectWithFailure = (kind: CliFailureKind, message: string): void => {
      const error = (kind === CLI_FAILURE_KIND.ABORTED
        ? createGenerationAbortError()
        : new Error(message)) as CliError;
      error.kind = kind;
      error.stdout = stdoutParts.join('');
      error.stderr = sanitizeErrorMessage(stderrParts.join(''));
      const processCode = (recordedError as { code?: unknown } | undefined)?.code;
      if (typeof processCode === 'string') error.code = processCode;
      if (kind === CLI_FAILURE_KIND.ABORTED) error.code = 'ABORT_ERR';
      if (kind === CLI_FAILURE_KIND.TERMINATION && terminationCause === CLI_TERMINATION_CAUSE.DEADLINE) {
        error.code = 'ETIMEDOUT';
      }
      reject(error);
    };

    const clearDeadlineTimers = (): void => {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      deadlineTimer = undefined;
      forceKillTimer = undefined;
    };

    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        env: env ?? process.env as Record<string, string>,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      recordProcessError(error instanceof Error ? error : new Error(String(error)));
      closed = true;
      clearDeadlineTimers();
      rejectWithFailure(CLI_FAILURE_KIND.PROCESS_ERROR, 'CLI process error');
      return;
    }

    const killProcessTree = (signal: NodeJS.Signals): void => {
      const pid = child.pid;
      if (typeof pid === 'number' && pid > 0 && process.platform !== 'win32') {
        try {
          process.kill(-pid, signal);
          return;
        } catch {
          /* Not a process-group leader (tests, already reaped). */
        }
      }
      try {
        child.kill(signal);
      } catch (error) {
        recordProcessError(error instanceof Error ? error : new Error(String(error)));
      }
    };

    const terminateDirectChild = (cause: CliTerminationCause): void => {
      if (terminationCause) return;
      if (cause === CLI_TERMINATION_CAUSE.DEADLINE && directChildExited && !closed) {
        return;
      }
      terminationCause = cause;

      killProcessTree('SIGTERM');
      if (forceKillTimer !== undefined || closed) return;
      forceKillTimer = setTimeout(() => {
        killProcessTree('SIGKILL');
        if (closed) return;
        closed = true;
        clearDeadlineTimers();
        options.signal?.removeEventListener('abort', abortHandler);
        rejectWithFailure(
          cause === CLI_TERMINATION_CAUSE.CALLER_ABORT
            ? CLI_FAILURE_KIND.ABORTED
            : CLI_FAILURE_KIND.TERMINATION,
          cause === CLI_TERMINATION_CAUSE.CALLER_ABORT
            ? 'Generation cancelled'
            : 'Process terminated before completion',
        );
      }, CLI_TERMINATION_GRACE_MS);
    };

    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        stdoutParts.push(data.toString());
        if (stdoutParts.join('').length > maxBuffer) {
          killProcessTree('SIGKILL');
        }
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => stderrParts.push(data.toString()));
    }

    child.on('error', recordProcessError);
    child.on('exit', () => {
      directChildExited = true;
      if (deadlineTimer !== undefined) {
        clearTimeout(deadlineTimer);
        deadlineTimer = undefined;
      }
    });
    child.on('close', (code, signal) => {
      if (closed) return;
      closed = true;
      clearDeadlineTimers();
      options.signal?.removeEventListener('abort', abortHandler);

      if (terminationCause === CLI_TERMINATION_CAUSE.CALLER_ABORT) {
        rejectWithFailure(CLI_FAILURE_KIND.ABORTED, 'Generation cancelled');
      } else if (recordedError) {
        rejectWithFailure(CLI_FAILURE_KIND.PROCESS_ERROR, 'CLI process error');
      } else if (code === 0 && !child.killed && !signal && !terminationCause) {
        resolve({ stdout: stdoutParts.join(''), stderr: stderrParts.join('') });
      } else if (typeof code === 'number' && code !== 0 && !child.killed && !signal && !terminationCause) {
        rejectWithFailure(CLI_FAILURE_KIND.EXIT, `Process exited with code ${code}`);
      } else {
        rejectWithFailure(CLI_FAILURE_KIND.TERMINATION, 'Process terminated before completion');
      }
    });

    const abortHandler = () => terminateDirectChild(CLI_TERMINATION_CAUSE.CALLER_ABORT);
    signal?.addEventListener('abort', abortHandler, { once: true });
    if (signal?.aborted) abortHandler();

    if (timeout > 0) deadlineTimer = setTimeout(
      () => terminateDirectChild(CLI_TERMINATION_CAUSE.DEADLINE),
      timeout,
    );

    // Always close the child's stdin. Some CLIs (notably `codex exec`) block
    // reading "additional input from stdin" until they see EOF; when there is no
    // `input` to write, we must still end() the stream so the child gets an
    // immediate EOF instead of hanging until the timeout (which yielded empty
    // output for the codex-cli provider).
    if (child.stdin) {
      child.stdin.on('error', recordProcessError);
      try {
        if (input) child.stdin.write(input);
        child.stdin.end();
      } catch (error) {
        recordProcessError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });
}
