/**
 * `setup-gateway` subcommand — configures the Claude Code CLI to route its
 * Anthropic-shaped requests through this bridge's HTTP gateway
 * (`/v1/messages`), instead of hitting api.anthropic.com directly.
 *
 * Unlike `setup-claude-code` (which registers this bridge as an MCP
 * server), this command does NOT touch `mcpServers`. It only concerns the
 * two environment variables Claude Code CLI reads to pick its Anthropic
 * endpoint and credential:
 *
 *   ANTHROPIC_BASE_URL   -> http://localhost:<gateway port>
 *   ANTHROPIC_AUTH_TOKEN -> the bridge's own auth token, sent as
 *                           `Authorization: Bearer <token>`. The gateway's
 *                           `bearerAuth` middleware (src/auth/middleware.ts)
 *                           also accepts the same token via `x-api-key`
 *                           (what ANTHROPIC_API_KEY would send) — either
 *                           works, ANTHROPIC_AUTH_TOKEN is just the more
 *                           conventional choice for "proxy in front of the
 *                           real API" setups.
 *
 * Runs entirely BEFORE the gateway runtime is created (same constraint as
 * setup-claude-code): no vault.db, no master.key, no ~/.llm-gateway side
 * effects from running this command.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_HTTP_PORT } from '../core/constants.js';

export interface GatewayEnvVars {
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_AUTH_TOKEN?: string;
}

/**
 * Resolve the gateway's HTTP port the same way `loadConfig()` (src/core/config.ts)
 * does — `LLM_GATEWAY_PORT` env var, default `DEFAULT_HTTP_PORT` — WITHOUT
 * importing `core/config.ts` itself, since that module has side effects at
 * call time (master key load/auto-generation, vault dir creation) that
 * `setup-gateway` must not trigger.
 */
export function resolveGatewayPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['LLM_GATEWAY_PORT'];
  if (!raw) return DEFAULT_HTTP_PORT;

  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`LLM_GATEWAY_PORT must be a valid port number (1-65535). Got: "${raw}"`);
  }
  return parsed;
}

/**
 * Resolve the bridge's own auth token, the same way `loadConfig()` reads it
 * (`LLM_GATEWAY_AUTH_TOKEN` env var). Returns `undefined` if unset — the
 * caller must warn that the gateway is running without auth in that case.
 */
export function resolveGatewayToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env['LLM_GATEWAY_AUTH_TOKEN']?.trim() || undefined;
}

/**
 * Build the exact env vars Claude Code CLI needs to route through the
 * bridge's HTTP gateway instead of api.anthropic.com.
 */
export function buildGatewayEnv(port: number, token: string | undefined): GatewayEnvVars {
  const vars: GatewayEnvVars = {
    ANTHROPIC_BASE_URL: `http://localhost:${port}`,
  };
  if (token) {
    vars.ANTHROPIC_AUTH_TOKEN = token;
  }
  return vars;
}

export interface SettingsEnvMergeResult {
  settingsPath: string;
  /** Path of the backup file, or null if no backup was needed (file didn't exist). */
  backupPath: string | null;
  /** The full settings object after the merge, as written to disk. */
  settings: Record<string, unknown>;
}

/**
 * Merge env vars into the `env` block of a Claude Code `settings.json`
 * file at `settingsPath`, WITHOUT touching any other top-level key.
 *
 * Same non-destructive contract as `mergeClaudeCodeConfig` in
 * claude-code-setup.ts:
 * - Tolerant read: missing/invalid JSON starts from `{}` instead of throwing.
 * - Backs up the original file (byte-for-byte) before writing, but only if
 *   the file existed in the first place.
 * - Never overwrites the whole file — only merges keys into the `env` object
 *   (existing `env` keys not present in `envVars` are preserved).
 *
 * `settingsPath` is a parameter (not hardcoded) so tests can point it at a
 * temp file instead of the user's real `~/.claude/settings.json`.
 */
export function mergeGatewayEnvIntoSettings(
  settingsPath: string,
  envVars: Record<string, string>,
): SettingsEnvMergeResult {
  let existingRaw: string | null = null;
  const fileExisted = existsSync(settingsPath);

  if (fileExisted) {
    existingRaw = readFileSync(settingsPath, 'utf8');
  }

  let settings: Record<string, unknown> = {};
  if (existingRaw !== null) {
    try {
      const parsed = JSON.parse(existingRaw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        settings = parsed as Record<string, unknown>;
      }
    } catch {
      // Corrupted/invalid JSON — start fresh from {}, but we still back up
      // the original content below.
      settings = {};
    }
  }

  let backupPath: string | null = null;
  if (fileExisted && existingRaw !== null) {
    backupPath = `${settingsPath}.bak-${Date.now()}`;
    writeFileSync(backupPath, existingRaw, 'utf8');
  }

  const existingEnv =
    settings['env'] && typeof settings['env'] === 'object' && !Array.isArray(settings['env'])
      ? (settings['env'] as Record<string, unknown>)
      : {};

  settings['env'] = {
    ...existingEnv,
    ...envVars,
  };

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  return { settingsPath, backupPath, settings };
}

export type GatewaySetupScope = 'user' | 'project';

/**
 * Resolve the settings.json path for a given scope: `~/.claude/settings.json`
 * for `user`, `./.claude/settings.json` (relative to cwd) for `project`.
 */
export function resolveSettingsPath(scope: GatewaySetupScope): string {
  return scope === 'project'
    ? join(process.cwd(), '.claude', 'settings.json')
    : join(homedir(), '.claude', 'settings.json');
}

export interface ParsedGatewayArgs {
  apply: boolean;
  scope: GatewaySetupScope;
}

export function parseGatewayArgs(argv: string[]): ParsedGatewayArgs {
  let apply = false;
  let scope: GatewaySetupScope = 'user';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--scope') {
      const value = argv[i + 1];
      if (value === 'user' || value === 'project') {
        scope = value;
        i++;
        continue;
      }
      throw new Error(`Invalid --scope value: "${value}". Expected "user" or "project".`);
    }
    if (arg?.startsWith('--scope=')) {
      const value = arg.slice('--scope='.length);
      if (value === 'user' || value === 'project') {
        scope = value;
        continue;
      }
      throw new Error(`Invalid --scope value: "${value}". Expected "user" or "project".`);
    }
  }

  return { apply, scope };
}

export interface SetupGatewayOptions {
  /** Override for the default settings.json path (tests only). */
  settingsPathOverride?: string;
  /** Override for env var lookup (tests only). */
  env?: NodeJS.ProcessEnv;
}

const CAVEAT =
  '[setup-gateway] CAVEAT: in gateway mode, Claude Code CLI no longer talks to Anthropic ' +
  'directly — every request (prompts AND code context) is routed through whatever PROVIDER ' +
  'this bridge is configured to send that model to. Unless the bridge routes to Anthropic ' +
  'itself, this is NOT "real Claude" and is NOT the same confidentiality/data-handling posture ' +
  'as talking to Anthropic directly. If the destination provider is a third-party or free tier ' +
  'that logs or trains on requests, do NOT point this at sensitive or proprietary code.';

/**
 * Orchestrates the `setup-gateway` subcommand. Runs entirely BEFORE the
 * gateway runtime is created — must not create vault.db, master.key, or
 * the ~/.llm-gateway directory.
 *
 * By default, only PRINTS the resolved env vars + instructions (no file
 * writes at all). Pass `--apply` to merge them into the `env` block of the
 * Claude Code settings.json (backed up first, non-destructive, `env`-block
 * only — never overwrites the rest of the file).
 *
 * Returns a process exit code (0 = success, 1 = failure).
 */
export async function runSetupGateway(
  argv: string[],
  options: SetupGatewayOptions = {},
): Promise<number> {
  const env = options.env ?? process.env;

  let apply: boolean;
  let scope: GatewaySetupScope;
  try {
    ({ apply, scope } = parseGatewayArgs(argv));
  } catch (err) {
    console.error(`[setup-gateway] ${(err as Error).message}`);
    return 1;
  }

  let port: number;
  try {
    port = resolveGatewayPort(env);
  } catch (err) {
    console.error(`[setup-gateway] ${(err as Error).message}`);
    return 1;
  }

  const token = resolveGatewayToken(env);
  const gatewayEnv = buildGatewayEnv(port, token);

  console.log(`[setup-gateway] Gateway port: ${port}`);
  if (token) {
    console.log(`[setup-gateway] Bridge auth token: found (LLM_GATEWAY_AUTH_TOKEN).`);
  } else {
    console.log(
      `[setup-gateway] WARNING: no LLM_GATEWAY_AUTH_TOKEN set — the gateway would run WITHOUT ` +
        `auth. Anyone who can reach localhost:${port} could use it. Fine for local-only use; ` +
        `set LLM_GATEWAY_AUTH_TOKEN (min 32 chars) before exposing the gateway beyond localhost.`,
    );
  }

  console.log('');
  console.log('[setup-gateway] Env vars for Claude Code CLI to route through this bridge:');
  console.log('');
  console.log(`  export ANTHROPIC_BASE_URL="${gatewayEnv.ANTHROPIC_BASE_URL}"`);
  if (gatewayEnv.ANTHROPIC_AUTH_TOKEN) {
    console.log(`  export ANTHROPIC_AUTH_TOKEN="${gatewayEnv.ANTHROPIC_AUTH_TOKEN}"`);
  }
  console.log('');
  console.log(
    '[setup-gateway] Equivalent settings.json block (merge into the "env" key — do NOT replace the whole file):',
  );
  console.log('');
  console.log(
    JSON.stringify({ env: gatewayEnv }, null, 2)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
  );
  console.log('');
  console.log(
    '[setup-gateway] REQUIRED: the gateway HTTP server must be RUNNING for this to work. Start it with one of:',
  );
  console.log('  llm-bridge --http     # MCP stdio + HTTP gateway');
  console.log('  llm-bridge serve      # HTTP gateway only, no MCP stdio');
  console.log('');
  console.log(CAVEAT);

  if (!apply) {
    console.log('');
    console.log(
      '[setup-gateway] Dry run (default): no files were modified. Re-run with --apply to write ' +
        'these env vars into settings.json automatically (non-destructive, env-block only, backed up).',
    );
    return 0;
  }

  const settingsPath = options.settingsPathOverride ?? resolveSettingsPath(scope);
  const envVarsRecord: Record<string, string> = {
    ANTHROPIC_BASE_URL: gatewayEnv.ANTHROPIC_BASE_URL,
  };
  if (gatewayEnv.ANTHROPIC_AUTH_TOKEN) {
    envVarsRecord.ANTHROPIC_AUTH_TOKEN = gatewayEnv.ANTHROPIC_AUTH_TOKEN;
  }

  const result = mergeGatewayEnvIntoSettings(settingsPath, envVarsRecord);

  console.log('');
  console.log(`[setup-gateway] Wrote env block to ${result.settingsPath} (scope: ${scope})`);
  if (result.backupPath) {
    console.log(`[setup-gateway] Backed up previous settings to ${result.backupPath}`);
  }

  return 0;
}
