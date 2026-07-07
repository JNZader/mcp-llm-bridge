/**
 * `setup-claude-code` subcommand — registers this bridge as an MCP server
 * inside Claude Code without touching the gateway runtime (no vault.db,
 * no master.key, no ~/.llm-gateway side effects).
 *
 * Two registration paths:
 * 1. Preferred: shell out to the official `claude mcp add` CLI, if present.
 * 2. Fallback: merge an `mcpServers.llm-bridge` entry directly into the
 *    user's `~/.claude.json`, preserving everything else in the file.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { isCliAvailable, execCliSync } from '../adapters/cli-utils.js';

export type ClaudeMcpScope = 'user' | 'project';

export interface EntrypointResolution {
  /** Absolute path to the built entrypoint (dist/index.js). */
  path: string;
  /** Whether that file currently exists on disk. */
  exists: boolean;
  /** Absolute path to the package root (parent of src/ or dist/). */
  root: string;
}

/**
 * Resolve the package root from a module URL that lives one directory below
 * it (e.g. `<root>/src/index.ts` or the built `<root>/dist/index.js`).
 */
export function resolvePackageRoot(currentModuleUrl: string): string {
  const currentFile = fileURLToPath(currentModuleUrl);
  // currentFile is <root>/src/index.ts (dev) or <root>/dist/index.js (built).
  // Both are exactly one directory below the package root.
  return dirname(dirname(currentFile));
}

/**
 * Resolve the absolute path to the built `dist/index.js` entrypoint that
 * should be registered with Claude Code, based on the currently running
 * module's URL (works whether invoked via `tsx src/index.ts` or the built
 * `dist/index.js`).
 */
export function resolveDistEntrypoint(currentModuleUrl: string): EntrypointResolution {
  const root = resolvePackageRoot(currentModuleUrl);
  const path = join(root, 'dist', 'index.js');
  return { path, exists: existsSync(path), root };
}

/**
 * Check whether the official `claude` CLI is available on PATH.
 */
export function isClaudeCliAvailable(): boolean {
  return isCliAvailable('claude', ['--version']);
}

/**
 * Register the bridge with Claude Code using the official `claude mcp add`
 * CLI. Throws if the command fails (caller should fall back to the manual
 * config merge in that case).
 */
export function registerViaClaudeCli(scope: ClaudeMcpScope, entrypointPath: string): string {
  return execCliSync('claude', [
    'mcp',
    'add',
    '--transport',
    'stdio',
    '--scope',
    scope,
    'llm-bridge',
    '--',
    'node',
    entrypointPath,
  ]);
}

export interface ClaudeConfigMergeResult {
  configPath: string;
  /** Path of the backup file, or null if no backup was needed (file didn't exist). */
  backupPath: string | null;
  /** The full config object after the merge, as written to disk. */
  config: Record<string, unknown>;
}

/**
 * Merge an `mcpServers[serverName] = serverConfig` entry into a Claude Code
 * config JSON file at `configPath`, WITHOUT touching any other content.
 *
 * - Tolerant read: if the file is missing or contains invalid JSON, starts
 *   from `{}` instead of throwing.
 * - Backs up the original file (byte-for-byte) before writing, but only if
 *   the file existed in the first place.
 * - Never overwrites the whole file wholesale — only merges the one key.
 *
 * `configPath` is a parameter (not hardcoded) so tests can point it at a
 * temp file instead of the user's real `~/.claude.json`.
 */
export function mergeClaudeCodeConfig(
  configPath: string,
  serverName: string,
  serverConfig: Record<string, unknown>,
): ClaudeConfigMergeResult {
  let existingRaw: string | null = null;
  const fileExisted = existsSync(configPath);

  if (fileExisted) {
    existingRaw = readFileSync(configPath, 'utf8');
  }

  let config: Record<string, unknown> = {};
  if (existingRaw !== null) {
    try {
      const parsed = JSON.parse(existingRaw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        config = parsed as Record<string, unknown>;
      }
    } catch {
      // Corrupted/invalid JSON — start fresh from {}, but we still back up
      // the original content below.
      config = {};
    }
  }

  let backupPath: string | null = null;
  if (fileExisted && existingRaw !== null) {
    backupPath = `${configPath}.bak-${Date.now()}`;
    writeFileSync(backupPath, existingRaw, 'utf8');
  }

  const existingMcpServers =
    config['mcpServers'] && typeof config['mcpServers'] === 'object' && !Array.isArray(config['mcpServers'])
      ? (config['mcpServers'] as Record<string, unknown>)
      : {};

  config['mcpServers'] = {
    ...existingMcpServers,
    [serverName]: serverConfig,
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

  return { configPath, backupPath, config };
}

export interface SetupClaudeCodeOptions {
  /** Override for the default `~/.claude.json` fallback path (tests only). */
  configPathOverride?: string;
}

function parseScope(argv: string[]): ClaudeMcpScope {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--scope') {
      const value = argv[i + 1];
      if (value === 'user' || value === 'project') return value;
      throw new Error(`Invalid --scope value: "${value}". Expected "user" or "project".`);
    }
    if (arg?.startsWith('--scope=')) {
      const value = arg.slice('--scope='.length);
      if (value === 'user' || value === 'project') return value;
      throw new Error(`Invalid --scope value: "${value}". Expected "user" or "project".`);
    }
  }
  return 'user';
}

/**
 * Orchestrates the `setup-claude-code` subcommand. Runs entirely BEFORE the
 * gateway runtime is created — must not create vault.db, master.key, or the
 * ~/.llm-gateway directory.
 *
 * Returns a process exit code (0 = success, 1 = failure).
 */
export async function runSetupClaudeCode(
  argv: string[],
  entrypointModuleUrl: string,
  options: SetupClaudeCodeOptions = {},
): Promise<number> {
  let scope: ClaudeMcpScope;
  try {
    scope = parseScope(argv);
  } catch (err) {
    console.error(`[setup-claude-code] ${(err as Error).message}`);
    return 1;
  }

  const entrypoint = resolveDistEntrypoint(entrypointModuleUrl);

  if (!entrypoint.exists) {
    console.error(
      `[setup-claude-code] Build output not found at ${entrypoint.path}.\n` +
        `Run "npm run build" first, then re-run "setup-claude-code".\n` +
        `(Fallback for local dev without a build: register manually with ` +
        `"npx tsx src/index.ts" as the command.)`,
    );
    return 1;
  }

  console.log(`[setup-claude-code] Using entrypoint: ${entrypoint.path}`);
  console.log(`[setup-claude-code] Scope: ${scope}`);

  if (isClaudeCliAvailable()) {
    try {
      registerViaClaudeCli(scope, entrypoint.path);
      console.log(
        `[setup-claude-code] Registered "llm-bridge" via the official Claude Code CLI (scope: ${scope}).\n` +
          `Verify with: claude mcp list`,
      );
      return 0;
    } catch (err) {
      console.warn(
        `[setup-claude-code] "claude mcp add" failed (${(err as Error).message}). ` +
          `Falling back to direct config merge.`,
      );
    }
  } else {
    console.log(
      `[setup-claude-code] "claude" CLI not found on PATH. Falling back to direct config merge.`,
    );
  }

  const configPath = options.configPathOverride ?? join(homedir(), '.claude.json');
  const result = mergeClaudeCodeConfig(configPath, 'llm-bridge', {
    command: 'node',
    args: [entrypoint.path],
  });

  console.log(`[setup-claude-code] Wrote MCP server entry to ${result.configPath}`);
  if (result.backupPath) {
    console.log(`[setup-claude-code] Backed up previous config to ${result.backupPath}`);
  }
  console.log(`[setup-claude-code] Verify with: claude mcp list`);

  return 0;
}
