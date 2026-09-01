/**
 * Antigravity CLI adapter — wraps `agy -p` command.
 *
 * Uses Google account credentials stored in the Vault.
 * Reads oauth_creds.json from the Vault, writing it to a temp
 * directory via HOME override before invocation.
 */

import { BaseCliAdapter, type CliAdapterConfig } from './base-cli-adapter.js';
import { sanitizeErrorMessage } from '../security/sanitize.js';
import type { Vault } from '../vault/vault.js';

/**
 * Parse `agy --output-format json` output into the response text.
 *
 * On failure the Antigravity CLI emits `{"error":{"type":...,"message":...,"code":...}}`
 * (possibly with exit code 0). Without this guard the raw error JSON would be
 * returned as if it were the model's answer. Exported for testing.
 */
export function parseAntigravityCliResponse(output: string): string {
  const parsed: Record<string, unknown> = JSON.parse(output);
  const response = parsed['response'] as string | undefined;
  if (response !== undefined) return response;

  const error = parsed['error'] as Record<string, unknown> | undefined;
  if (error && typeof error === 'object') {
    const type = typeof error['type'] === 'string' ? error['type'] : 'UnknownError';
    const message = typeof error['message'] === 'string' ? error['message'] : 'no message';
    throw new Error(sanitizeErrorMessage(`Antigravity CLI returned an error envelope (${type}): ${message}`));
  }

  return output;
}

const ANTIGRAVITY_CONFIG: CliAdapterConfig = {
  id: 'antigravity-cli',
  name: 'Antigravity CLI',
  cliCommand: 'agy',
  defaultModel: 'gemini-3.7-flash-medium',
  supportsSystemPrompt: false,
  models: [
    // Gemini 3.7 series
    { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash (High)', provider: 'antigravity-cli', maxTokens: 2000000 },
    { id: 'gemini-3.7-flash-medium', name: 'Gemini 3.7 Flash (Medium)', provider: 'antigravity-cli', maxTokens: 2000000 },
    { id: 'gemini-3.7-flash-low', name: 'Gemini 3.7 Flash (Low)', provider: 'antigravity-cli', maxTokens: 2000000 },
    // Gemini 3.6 series
    { id: 'gemini-3.6-flash-high', name: 'Gemini 3.6 Flash (High)', provider: 'antigravity-cli', maxTokens: 2000000 },
    { id: 'gemini-3.6-flash-medium', name: 'Gemini 3.6 Flash (Medium)', provider: 'antigravity-cli', maxTokens: 2000000 },
    { id: 'gemini-3.6-flash-low', name: 'Gemini 3.6 Flash (Low)', provider: 'antigravity-cli', maxTokens: 2000000 },
    // Gemini 3.5 series
    { id: 'gemini-3.5-flash-high', name: 'Gemini 3.5 Flash (High)', provider: 'antigravity-cli', maxTokens: 2000000 },
    { id: 'gemini-3.5-flash-medium', name: 'Gemini 3.5 Flash (Medium)', provider: 'antigravity-cli', maxTokens: 2000000 },
    { id: 'gemini-3.5-flash-low', name: 'Gemini 3.5 Flash (Low)', provider: 'antigravity-cli', maxTokens: 2000000 },
    // Gemini 3.1 series
    { id: 'gemini-3.1-pro-high', name: 'Gemini 3.1 Pro (High)', provider: 'antigravity-cli', maxTokens: 2000000 },
    { id: 'gemini-3.1-pro-low', name: 'Gemini 3.1 Pro (Low)', provider: 'antigravity-cli', maxTokens: 2000000 },
    // Other models
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)', provider: 'antigravity-cli', maxTokens: 200000 },
    { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)', provider: 'antigravity-cli', maxTokens: 200000 },
    { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)', provider: 'antigravity-cli', maxTokens: 128000 },
  ],
};

export class AntigravityCliAdapter extends BaseCliAdapter {
  readonly config = ANTIGRAVITY_CONFIG;

  constructor(vault: Vault) {
    super(vault);
  }

  protected buildArgs(model: string): string[] {
    // `-p` is print/non-interactive mode, not the prompt. Prompt goes on stdin.
    return ['-p', '--output-format', 'json', '--model', model];
  }

  protected parseResponse(output: string): string {
    return parseAntigravityCliResponse(output);
  }

  protected validateProviderFiles(files: Array<{ fileName: string }>): void {
    const hasSettings = files.some((file) => file.fileName === 'settings.json');
    const hasOauthCreds = files.some((file) => file.fileName === 'oauth_creds.json');
    
    if (!hasSettings || !hasOauthCreds) {
      throw new Error('Antigravity CLI auth incomplete: upload settings.json and oauth_creds.json');
    }
  }
}
