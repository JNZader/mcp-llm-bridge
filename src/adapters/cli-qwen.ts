/**
 * Qwen CLI adapter — wraps `qwen --model` with the prompt on stdin.
 *
 * Uses Alibaba Cloud credentials stored in the Vault.
 * Reads oauth_creds.json from the Vault, writing it to a temp
 * directory via HOME override before invocation.
 */

import { BaseCliAdapter, type CliAdapterConfig } from './base-cli-adapter.js';
import { sanitizeErrorMessage } from '../security/sanitize.js';
import type { Vault } from '../vault/vault.js';

/**
 * Parse Qwen CLI output into the response text.
 *
 * Qwen CLI is a Gemini CLI fork: on failure it can emit
 * `{"error":{"type":...,"message":...}}` (possibly with exit code 0). Without
 * this guard the raw error JSON would be returned as if it were the model's
 * answer. Non-JSON output is returned trimmed as-is. Exported for testing.
 */
export function parseQwenCliResponse(output: string): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(output);
  } catch {
    return output.trim();
  }

  const text = (parsed['response'] as string | undefined)
    ?? (parsed['result'] as string | undefined);
  if (text !== undefined) return text;

  const error = parsed['error'] as Record<string, unknown> | undefined;
  if (error && typeof error === 'object') {
    const type = typeof error['type'] === 'string' ? error['type'] : 'UnknownError';
    const message = typeof error['message'] === 'string' ? error['message'] : 'no message';
    throw new Error(sanitizeErrorMessage(`Qwen CLI returned an error envelope (${type}): ${message}`));
  }

  return output;
}

const QWEN_CONFIG: CliAdapterConfig = {
  id: 'qwen-cli',
  name: 'Qwen CLI',
  cliCommand: 'qwen',
  defaultModel: 'qwen3-coder-plus',
  models: [
    { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus', provider: 'qwen-cli', maxTokens: 8192 },
    { id: 'qwen-plus', name: 'Qwen Plus', provider: 'qwen-cli', maxTokens: 8192 },
    { id: 'qwen-max', name: 'Qwen Max', provider: 'qwen-cli', maxTokens: 8192 },
    { id: 'qwen-turbo', name: 'Qwen Turbo', provider: 'qwen-cli', maxTokens: 8192 },
  ],
};

export class QwenCliAdapter extends BaseCliAdapter {
  readonly config = QWEN_CONFIG;

  constructor(vault: Vault) {
    super(vault);
  }

  protected buildArgs(model: string): string[] {
    return ['--model', model];
  }

  protected parseResponse(output: string): string {
    return parseQwenCliResponse(output);
  }

  protected validateProviderFiles(files: Array<{ fileName: string }>): void {
    const hasSettings = files.some((file) => file.fileName === 'settings.json');
    const hasOauthCreds = files.some((file) => file.fileName === 'oauth_creds.json');
    
    if (!hasSettings || !hasOauthCreds) {
      throw new Error('Qwen CLI auth incomplete: upload settings.json and oauth_creds.json');
    }
  }
}
