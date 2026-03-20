/**
 * CLI utility helpers for subprocess execution.
 */

import { execFileSync, execFile } from 'node:child_process';

/**
 * Default timeout for CLI subprocess (2 minutes).
 */
export const DEFAULT_CLI_TIMEOUT = 120_000;

/**
 * Default max buffer for stdout/stderr (10MB).
 */
export const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

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
  stdout?: string;
  stderr?: string;
}

/**
 * Execute a CLI command asynchronously using execFile.
 * This is the recommended approach for production use.
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
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  const { input, timeout = DEFAULT_CLI_TIMEOUT, maxBuffer = DEFAULT_MAX_BUFFER, env } = options;

  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      timeout,
      maxBuffer,
      encoding: 'utf8',
      env: env ?? process.env as Record<string, string>,
    });

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    }
    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    }

    if (input && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`Process exited with code ${code}`) as CliError;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });

    child.on('error', reject);
  });
}
