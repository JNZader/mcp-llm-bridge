/**
 * Claude CLI adapter — wraps `claude -p` command.
 *
 * Uses Claude Max subscription credentials stored in the Vault.
 * Reads .credentials.json from the Vault, writing it to a temp
 * directory via HOME override before invocation.
 */

import { BaseCliAdapter, type CliAdapterConfig } from './base-cli-adapter.js';
import { sanitizeErrorMessage } from '../security/sanitize.js';
import type { Vault } from '../vault/vault.js';

const CLAUDE_CONFIG: CliAdapterConfig = {
  id: 'claude-cli',
  name: 'Claude CLI',
  cliCommand: 'claude',
  defaultModel: 'claude-sonnet-4-5',
  supportsSystemPrompt: true,
  models: [
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (Max)', provider: 'claude-cli', maxTokens: 8192 },
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6 (Max)', provider: 'claude-cli', maxTokens: 8192 },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Max)', provider: 'claude-cli', maxTokens: 8192 },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (Max)', provider: 'claude-cli', maxTokens: 8192 },
  ],
};

/**
 * Parse `claude -p --output-format json` output into the result text.
 *
 * The Claude CLI can EXIT 0 while emitting an ERROR envelope, e.g.
 * `{"type":"result","subtype":"error_max_turns","is_error":true,
 *   "stop_reason":"tool_use","errors":["Reached maximum number of turns (1)"]}`
 * — with no `result` and no `content` field. Without this guard the raw
 * error JSON would be returned as if it were the model's answer (and the
 * gateway would serve it with HTTP 200). Exported for testing.
 */
export function parseClaudeCliResponse(output: string): string {
  const parsed: Record<string, unknown> = JSON.parse(output);

  const subtype = parsed['subtype'];
  if (parsed['is_error'] === true || (typeof subtype === 'string' && subtype.startsWith('error'))) {
    const errors = Array.isArray(parsed['errors'])
      ? (parsed['errors'] as unknown[]).map(String).join('; ')
      : undefined;
    const label = typeof subtype === 'string' ? subtype : 'unknown';
    throw new Error(sanitizeErrorMessage(
      `Claude CLI returned an error envelope (subtype: ${label})${errors ? `: ${errors}` : ''}`,
    ));
  }

  const content = parsed['content'];
  const firstContent = Array.isArray(content) ? (content[0] as Record<string, unknown> | undefined) : undefined;
  return (parsed['result'] as string | undefined)
    ?? (firstContent?.['text'] as string | undefined)
    ?? output;
}

export class ClaudeCliAdapter extends BaseCliAdapter {
  readonly config = CLAUDE_CONFIG;

  constructor(vault: Vault) {
    super(vault);
  }

  protected buildArgs(model: string): string[] {
    // `-p` is print/non-interactive mode. Prompt and system travel on stdin
    // (merged by BaseCliAdapter) so a 20k–80k payload never lands on argv.
    //
    // `--tools ''` disables all built-in tools ("Use \"\" to disable all
    // tools" per `claude --help`), so a single-turn print call can never stop
    // on `tool_use` — which is what produced exit-0 `error_max_turns`
    // envelopes under `--max-turns 1`. parseClaudeCliResponse remains the
    // safety net for any other error envelope.
    return ['-p', '--output-format', 'json', '--max-turns', '1', '--tools', '', '--model', model];
  }

  protected parseResponse(output: string): string {
    return parseClaudeCliResponse(output);
  }
}
