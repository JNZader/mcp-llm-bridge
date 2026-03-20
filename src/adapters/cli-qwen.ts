/**
 * Qwen CLI adapter — wraps `qwen -p` command.
 *
 * Uses Alibaba Cloud credentials stored in the Vault.
 * Reads oauth_creds.json from the Vault, writing it to a temp
 * directory via HOME override before invocation.
 */

import { BaseCliAdapter, type CliAdapterConfig } from './base-cli-adapter.js';
import type { Vault } from '../vault/vault.js';

const QWEN_CONFIG: CliAdapterConfig = {
  id: 'qwen-cli',
  name: 'Qwen CLI',
  cliCommand: 'qwen',
  defaultModel: 'qwen3-coder-plus',
  supportsSystemPrompt: false,
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

  protected buildArgs(model: string, prompt: string): string[] {
    return ['-p', JSON.stringify(prompt), '--model', model];
  }

  protected parseResponse(output: string): string {
    // Try to parse JSON output if available
    try {
      const parsed: Record<string, unknown> = JSON.parse(output);
      return (parsed['response'] as string | undefined)
        ?? (parsed['result'] as string | undefined)
        ?? output;
    } catch {
      return output.trim();
    }
  }

  protected validateProviderFiles(files: Array<{ fileName: string }>): void {
    const hasSettings = files.some((file) => file.fileName === 'settings.json');
    const hasOauthCreds = files.some((file) => file.fileName === 'oauth_creds.json');
    
    if (!hasSettings || !hasOauthCreds) {
      throw new Error('Qwen CLI auth incomplete: upload settings.json and oauth_creds.json');
    }
  }
}
