/**
 * OpenCode CLI adapter — wraps `opencode run` command.
 *
 * Uses subscription-based routing through OpenCode's servers.
 * Reads credentials from auth.json stored in the Vault, writing
 * it to a temp directory via XDG_DATA_HOME before invocation.
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { LLMProvider, GenerateRequest, GenerateResponse, ModelInfo } from '../core/types.js';
import type { Vault } from '../vault/vault.js';
import { assertPromptNotOnArgv, execCliAsync, execCliSync, isCliAvailableAsync } from './cli-utils.js';
import { GENERATE_COMPLETE_STOP, GENERATE_LENGTH_STOP } from '../core/types.js';
import {
  DEFAULT_CLI_GENERATE_TIMEOUT_MS,
  resolveCliGenerateTimeoutMs,
  resolvePositiveIntEnv,
} from '../core/constants.js';
import { DynamicModelCache } from './model-cache.js';

/**
 * Parse OpenCode's newline-delimited JSON output into text + token usage.
 *
 * Exported so consumers (e.g. ghagga) can reuse this parser instead of
 * maintaining a duplicate. Canonical implementation lives here.
 */
export function parseOpenCodeOutput(raw: string): { text: string; tokens?: { input?: number; output?: number } } {
  const lines = raw.split('\n').filter(line => line.trim().length > 0);
  const textParts: string[] = [];
  let tokens: { input?: number; output?: number } | undefined;

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event['type'] === 'text') {
        const part = event['part'] as Record<string, unknown> | undefined;
        if (part?.['text']) {
          textParts.push(part['text'] as string);
        }
      } else if (event['type'] === 'step_finish') {
        const part = event['part'] as Record<string, unknown> | undefined;
        if (part?.['tokens']) {
          tokens = part['tokens'] as { input?: number; output?: number };
        }
      }
    } catch { /* skip malformed lines */ }
  }

  return { text: textParts.join(''), tokens };
}

/**
 * Detect an OpenCode backend error event in the `--format json` stream.
 * OpenCode emits `{"type":"error","error":{"name":...,"data":{"message":...,"ref":...}}}`
 * on a backend/auth/service failure (often with a zero exit code), which the
 * text parser silently skips. Returns a concise diagnostic string, or undefined
 * when no error event is present. Exported so the gateway surfaces a clear
 * cause instead of an opaque "Process exited with code 1".
 */
export function extractOpenCodeError(raw: string): string | undefined {
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event['type'] !== 'error') continue;
      const err = event['error'] as Record<string, unknown> | undefined;
      const name = (err?.['name'] as string | undefined) ?? 'UnknownError';
      const data = err?.['data'] as Record<string, unknown> | undefined;
      const message = (data?.['message'] as string | undefined) ?? 'no message';
      const ref = data?.['ref'] as string | undefined;
      return `OpenCode backend error: ${name} — ${message}${ref ? ` (ref: ${ref})` : ''}`;
    } catch {
      /* skip malformed lines */
    }
  }
  return undefined;
}

const OPENCODE_MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;
const OPENCODE_MODELS_TIMEOUT_MS = 15_000;

/**
 * Generate timeout for `opencode run`. Default CLI timeout is 120s. GLM-5.3-Flash
 * on a 20k–80k legal RAG prompt can sit past 170s with empty stdout, which used
 * to surface as spawnSync ETIMEDOUT → HTTP 500. 600s still lost Consorcio items;
 * 30 min is the serving budget, shared with other stdin CLIs. Stay under
 * GENERATE_HTTP_TIMEOUT_MS so a slow prompt fails here instead of as a
 * client-side transport timeout that Consorcio retries (double-billed).
 */
export const OPENCODE_GENERATE_TIMEOUT_MS = DEFAULT_CLI_GENERATE_TIMEOUT_MS;

/** Exec budget. Default is `OPENCODE_GENERATE_TIMEOUT_MS`; CI short-circuits via env. */
export function resolveOpenCodeGenerateTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  return resolvePositiveIntEnv(
    env,
    'OPENCODE_GENERATE_TIMEOUT_MS',
    resolveCliGenerateTimeoutMs(env),
  );
}

export function isCliTimeoutError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const execError = error as { code?: unknown; killed?: unknown; signal?: unknown };
  return execError.code === 'ETIMEDOUT' || execError.killed === true || execError.signal === 'SIGTERM';
}

/** Map a CLI exec outcome onto Consorcio's complete vs truncated stop set. */
export function openCodeStopReason(error: unknown, hasText: boolean): string {
  if (hasText && isCliTimeoutError(error)) {
    return GENERATE_LENGTH_STOP.LENGTH;
  }
  return GENERATE_COMPLETE_STOP.STOP;
}

/** Fallback if `opencode models` is down. Live `opencode models --refresh` 2026-08-31. */
const OPENCODE_DECLARED_MODEL_IDS = [
  'opencode/big-pickle',
  'opencode/ling-3.0-flash-fin-free',
  'opencode/mimo-v2.5-free',
  'opencode/muse-spark-1.2-contributor-free',
  'opencode/nemotron-3-ultra-free',
  'opencode/nemotron-3.5-lightning-free',
  'opencode-go/deepseek-v4-flash',
  'opencode-go/deepseek-v4-flash-vision-exp',
  'opencode-go/deepseek-v4-pro',
  'opencode-go/glm-5.1',
  'opencode-go/glm-5.2',
  'opencode-go/glm-5.3',
  'opencode-go/glm-5.3-flash',
  'opencode-go/gpt-5.6-luna',
  'opencode-go/grok-4.6',
  'opencode-go/hy3',
  'opencode-go/hy4-preview',
  'opencode-go/kimi-k2.6',
  'opencode-go/kimi-k2.7-code',
  'opencode-go/kimi-k3',
  'opencode-go/longcat-2.0',
  'opencode-go/mimo-v2.5',
  'opencode-go/mimo-v2.5-pro',
  'opencode-go/minimax-m2.7',
  'opencode-go/minimax-m3',
  'opencode-go/muse-spark-1.2-contributor',
  'opencode-go/qwen3.6-plus',
  'opencode-go/qwen3.7-max',
  'opencode-go/qwen3.7-plus',
  'opencode-go/qwen3.8-flash',
  'opencode-go/qwen3.8-max',
] as const;

function openCodeModelInfo(id: string): ModelInfo {
  const leaf = id.split('/').pop() ?? id;
  const name = leaf
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return { id, name, provider: 'opencode-cli', maxTokens: 8192 };
}

/** Parse `opencode models` stdout (one `provider/model` id per line). */
export function parseOpenCodeModelsList(raw: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const line of raw.split('\n')) {
    const id = line.trim();
    if (!OPENCODE_MODEL_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    models.push(openCodeModelInfo(id));
  }
  return models;
}

const OPENCODE_DECLARED_MODELS: ModelInfo[] = OPENCODE_DECLARED_MODEL_IDS.map(openCodeModelInfo);

export class CliOpenCodeAdapter implements LLMProvider {
  readonly id = 'opencode-cli';
  readonly name = 'OpenCode CLI';
  readonly type = 'cli' as const;

  private readonly vault: Vault;
  private readonly modelCache: DynamicModelCache;

  constructor(vault: Vault) {
    this.vault = vault;
    this.modelCache = new DynamicModelCache(
      OPENCODE_DECLARED_MODELS,
      () => this.discoverModels(),
      this.id,
    );
  }

  get models(): ModelInfo[] {
    return this.modelCache.get();
  }

  async refreshModels(now: number = Date.now()): Promise<void> {
    return this.modelCache.refresh(now);
  }

  private async discoverModels(): Promise<ModelInfo[] | null> {
    const { stdout } = await execCliAsync('opencode', ['models'], {
      timeout: OPENCODE_MODELS_TIMEOUT_MS,
    });
    const discovered = parseOpenCodeModelsList(stdout);
    return discovered.length > 0 ? discovered : null;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const model = request.model ?? 'opencode/big-pickle';
    const authContent = this.vault.getFile('opencode', 'auth.json', request.project);

    // Build temp dir for auth.json if available
    const tempBase = `/tmp/opencode-auth-${process.pid}-${Date.now()}`;
    const authDir = join(tempBase, 'opencode');

    try {
      // Set up auth.json via XDG_DATA_HOME if available
      const env: Record<string, string> = { ...process.env as Record<string, string> };

      if (authContent) {
        mkdirSync(authDir, { recursive: true, mode: 0o700 });
        writeFileSync(join(authDir, 'auth.json'), authContent, { mode: 0o600 });
        env['XDG_DATA_HOME'] = tempBase;
      }

      const args = ['run', '--model', model, '--format', 'json'];

      // Combine system + user prompt (OpenCode CLI has no --system flag)
      const fullPrompt = request.system
        ? `${request.system}\n\n---\n\n${request.prompt}`
        : request.prompt;

      assertPromptNotOnArgv('opencode', args, [fullPrompt, request.system, request.prompt]);
      const output = execCliSync('opencode', args, {
        input: fullPrompt,
        env,
        timeout: resolveOpenCodeGenerateTimeoutMs(env),
      });

      const parsed = parseOpenCodeOutput(output);
      if (!parsed.text) {
        const backendError = extractOpenCodeError(output);
        if (backendError) throw new Error(backendError);
      }
      const totalTokens = parsed.tokens
        ? (parsed.tokens.input ?? 0) + (parsed.tokens.output ?? 0)
        : 0;

      return {
        text: parsed.text || output.trim(),
        provider: this.id,
        model,
        tokensUsed: totalTokens,
        resolvedProvider: this.id,
        resolvedModel: model,
        fallbackUsed: false,
        stop_reason: GENERATE_COMPLETE_STOP.STOP,
        finish_reason: GENERATE_COMPLETE_STOP.STOP,
      };
    } catch (error) {
      const execError = error as { stdout?: string; message?: string };
      if (execError.stdout) {
        const parsed = parseOpenCodeOutput(execError.stdout);
        if (parsed.text) {
          const stopReason = openCodeStopReason(error, true);
          return {
            text: parsed.text,
            provider: this.id,
            model,
            tokensUsed: 0,
            resolvedProvider: this.id,
            resolvedModel: model,
            fallbackUsed: false,
            stop_reason: stopReason,
            finish_reason: stopReason,
          };
        }
        const backendError = extractOpenCodeError(execError.stdout);
        if (backendError) throw new Error(backendError);
      }
      throw new Error(
        `OpenCode CLI failed: ${execError.message ?? String(error)}`,
      );
    } finally {
      if (existsSync(tempBase)) {
        rmSync(tempBase, { recursive: true, force: true });
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    return isCliAvailableAsync('opencode');
  }
}
