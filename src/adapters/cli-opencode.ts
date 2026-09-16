/**
 * OpenCode CLI adapter — wraps `opencode run` command.
 *
 * Uses subscription-based routing through OpenCode's servers.
 * Reads credentials from auth.json stored in the Vault, writing
 * it to a temp directory via XDG_DATA_HOME before invocation.
 */

import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GENERATE_COMPLETE_STOP,
  GENERATE_LENGTH_STOP,
  USAGE_PROVENANCE_REASON,
  USAGE_PROVENANCE_STATUS,
  type GenerateExecutionOptions,
  type LLMProvider,
  type GenerateRequest,
  type GenerateResponse,
  type ModelInfo,
  type UsageProvenance,
  type ToolEvidence,
} from '../core/types.js';
import type { Vault } from '../vault/vault.js';
import {
  assertPromptNotOnArgv,
  CLI_FAILURE_KIND,
  execCliAsync,
  isCliAvailableAsync,
  type CliFailureKind,
} from './cli-utils.js';
import {
  DEFAULT_CLI_GENERATE_TIMEOUT_MS,
  resolveCliGenerateTimeoutMs,
  resolvePositiveIntEnv,
} from '../core/constants.js';
import { DynamicModelCache } from './model-cache.js';
import { isGenerationAbortError, throwIfGenerationAborted } from '../core/generation-cancellation.js';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Classifies one OpenCode step-finish usage payload without claiming billing accuracy. */
export function classifyOpenCodeUsage(tokens: unknown, eventCount: number): UsageProvenance {
  if (!Number.isSafeInteger(eventCount) || eventCount < 0) {
    return { status: USAGE_PROVENANCE_STATUS.UNKNOWN, reason: USAGE_PROVENANCE_REASON.INVALID };
  }
  if (eventCount === 0) {
    return { status: USAGE_PROVENANCE_STATUS.UNKNOWN, reason: USAGE_PROVENANCE_REASON.ABSENT };
  }
  if (eventCount > 1) {
    return { status: USAGE_PROVENANCE_STATUS.UNKNOWN, reason: USAGE_PROVENANCE_REASON.MULTIPLE_EVENTS };
  }
  if (!isRecord(tokens)) {
    return {
      status: USAGE_PROVENANCE_STATUS.UNKNOWN,
      reason: tokens === undefined ? USAGE_PROVENANCE_REASON.ABSENT : USAGE_PROVENANCE_REASON.INVALID,
    };
  }

  const input = tokens['input'];
  const output = tokens['output'];
  if (input === undefined && output === undefined) {
    return { status: USAGE_PROVENANCE_STATUS.UNKNOWN, reason: USAGE_PROVENANCE_REASON.ABSENT };
  }
  if ((input !== undefined && !isValidCounter(input)) || (output !== undefined && !isValidCounter(output))) {
    return { status: USAGE_PROVENANCE_STATUS.UNKNOWN, reason: USAGE_PROVENANCE_REASON.INVALID };
  }
  if (input === undefined) {
    return { status: USAGE_PROVENANCE_STATUS.PARTIAL, origin: 'cli-output', eventCount: 1, outputTokens: output as number };
  }
  if (output === undefined) {
    return { status: USAGE_PROVENANCE_STATUS.PARTIAL, origin: 'cli-output', eventCount: 1, inputTokens: input };
  }
  if (!Number.isSafeInteger(input + output)) {
    return { status: USAGE_PROVENANCE_STATUS.UNKNOWN, reason: USAGE_PROVENANCE_REASON.OVERFLOW };
  }
  return {
    status: USAGE_PROVENANCE_STATUS.REPORTED,
    origin: 'cli-output',
    eventCount: 1,
    inputTokens: input,
    outputTokens: output,
  };
}

/** Extracts usage provenance from tolerant NDJSON parsing while retaining legacy parser behavior. */
export function extractOpenCodeUsageProvenance(raw: string): UsageProvenance {
  let eventCount = 0;
  let tokens: unknown;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as unknown;
      if (!isRecord(event) || event['type'] !== 'step_finish') continue;
      eventCount += 1;
      const part = event['part'];
      tokens = isRecord(part) ? part['tokens'] : undefined;
    } catch {
      /* skip malformed lines */
    }
  }
  return classifyOpenCodeUsage(tokens, eventCount);
}

const TOOL_EVENT_TYPES = new Set(['tool_call', 'tool_use', 'tool_start', 'tool_result', 'tool_end']);

function isPlausibleToolEventType(value: unknown): value is string {
  return typeof value === 'string' && (TOOL_EVENT_TYPES.has(value) || /^tool(?:[_-]|$)/.test(value));
}

function isValidStepFinishPart(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value['tokens'])) return false;
  const tokens = value['tokens'];
  const input = tokens['input'];
  const output = tokens['output'];
  return (
    (input !== undefined || output !== undefined) &&
    (input === undefined || isValidCounter(input)) &&
    (output === undefined || isValidCounter(output))
  );
}

function isValidStepStartPart(value: unknown): value is Record<string, unknown> {
  // OpenCode emits lifecycle events around a model step.  A step_start event is
  // not tool activity, but it must still be a structured event; accepting an
  // unshaped marker would let corrupted streams masquerade as complete
  // no-tools evidence.
  return isRecord(value) && typeof value['id'] === 'string' && value['id'].length > 0;
}

/** Parse only explicit tool events; malformed NDJSON is not evidence of isolation. */
export function parseOpenCodeToolEvidence(raw: string): ToolEvidence | undefined {
  let toolCallCount = 0;
  let recognizedEventCount = 0;
  let terminalStepFinish = false;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (!isRecord(event)) return undefined;
    const type = event['type'];
    const part = event['part'];
    if (isPlausibleToolEventType(type)) {
      toolCallCount += 1;
      recognizedEventCount += 1;
      terminalStepFinish = false;
    } else if (isRecord(part) && isPlausibleToolEventType(part['type'])) {
      toolCallCount += 1;
      recognizedEventCount += 1;
      terminalStepFinish = false;
    } else if (type === 'step_start' && isValidStepStartPart(part)) {
      recognizedEventCount += 1;
      terminalStepFinish = false;
    } else if (type === 'text' && isRecord(part) && typeof part['text'] === 'string' && part['text'].length > 0) {
      recognizedEventCount += 1;
      terminalStepFinish = false;
    } else if (type === 'step_finish' && isValidStepFinishPart(part)) {
      recognizedEventCount += 1;
      terminalStepFinish = true;
    } else {
      // The JSON stream is the only no-tools observability boundary. Unknown or
      // malformed events must not be silently ignored as if the stream were complete.
      return undefined;
    }
  }
  if (recognizedEventCount === 0 || (toolCallCount === 0 && !terminalStepFinish)) return undefined;
  return {
    status: 'complete',
    mode: 'none',
    source: 'opencode-json-events',
    toolCallCount,
    enforcement: 'temporary-opencode-agent-config',
    observable: true,
  };
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

  async generate(request: GenerateRequest, executionOptions?: GenerateExecutionOptions): Promise<GenerateResponse> {
    throwIfGenerationAborted(executionOptions);
    const model = request.model ?? 'opencode/big-pickle';
    const authContent = this.vault.getFile('opencode', 'auth.json', request.project);
    throwIfGenerationAborted(executionOptions);

    let temporaryAuthRoot: string | undefined;
    let temporaryProjectRoot: string | undefined;

    try {
      // Set up auth.json via XDG_DATA_HOME if available
      const env: Record<string, string> = { ...process.env as Record<string, string> };

      if (authContent) {
        temporaryAuthRoot = mkdtempSync(join(tmpdir(), 'opencode-auth-'));
        const authDir = join(temporaryAuthRoot, 'opencode');
        mkdirSync(authDir, { recursive: true, mode: 0o700 });
        writeFileSync(join(authDir, 'auth.json'), authContent, { mode: 0o600 });
        env['XDG_DATA_HOME'] = temporaryAuthRoot;
      }

       const args = ['run', '--model', model];
       if (request.tools === 'none') {
         temporaryProjectRoot = mkdtempSync(join(tmpdir(), 'opencode-no-tools-'));
         const noToolsConfig = {
           agent: {
             'gate1-no-tools': {
               model,
               tools: { '*': false },
               permission: { '*': 'deny' },
             },
           },
           permission: { '*': 'deny' },
           tools: { '*': false },
           mcp: {},
           plugin: [],
           instructions: [],
           snapshot: false,
           share: 'disabled',
           autoupdate: false,
         };
         writeFileSync(join(temporaryProjectRoot, 'opencode.json'), JSON.stringify(noToolsConfig), { mode: 0o600 });
         args.push('--agent', 'gate1-no-tools', '--pure', '--dir', temporaryProjectRoot);
       }
       args.push('--format', 'json');

      // Combine system + user prompt (OpenCode CLI has no --system flag)
      const fullPrompt = request.system
        ? `${request.system}\n\n---\n\n${request.prompt}`
        : request.prompt;

      assertPromptNotOnArgv('opencode', args, [fullPrompt, request.system, request.prompt]);
      const { stdout: output } = await execCliAsync('opencode', args, {
        input: fullPrompt,
        env,
        timeout: resolveOpenCodeGenerateTimeoutMs(env),
        signal: executionOptions?.signal,
      });

      throwIfGenerationAborted(executionOptions);

      const parsed = parseOpenCodeOutput(output);
      const toolEvidence = request.tools === 'none' ? parseOpenCodeToolEvidence(output) : undefined;
      if (request.tools === 'none' && (!toolEvidence || toolEvidence.toolCallCount !== 0)) {
        throw new Error('OpenCode tool evidence unavailable or reported tool calls');
      }
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
        usageProvenance: extractOpenCodeUsageProvenance(output),
        resolvedProvider: this.id,
        resolvedModel: model,
        fallbackUsed: false,
        ...(toolEvidence ? { toolEvidence } : {}),
        stop_reason: GENERATE_COMPLETE_STOP.STOP,
        finish_reason: GENERATE_COMPLETE_STOP.STOP,
      };
    } catch (error) {
      if (isGenerationAbortError(error)) throw error;
      const execError = error as { code?: string; kind?: CliFailureKind; stdout?: string; message?: string };
      if (execError.code === 'ETIMEDOUT') {
        throw new Error('OpenCode CLI timed out');
      }
      if (execError.kind === CLI_FAILURE_KIND.EXIT && execError.stdout) {
        let toolEvidence: ToolEvidence | undefined;
        if (request.tools === 'none') {
          toolEvidence = parseOpenCodeToolEvidence(execError.stdout);
          if (!toolEvidence || toolEvidence.toolCallCount !== 0) {
            throw new Error('OpenCode tool evidence unavailable or reported tool calls');
          }
        }
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
            ...(toolEvidence ? { toolEvidence } : {}),
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
      if (temporaryAuthRoot !== undefined) {
        rmSync(temporaryAuthRoot, { recursive: true, force: true });
      }
      if (temporaryProjectRoot !== undefined) {
        rmSync(temporaryProjectRoot, { recursive: true, force: true });
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    return isCliAvailableAsync('opencode');
  }
}
