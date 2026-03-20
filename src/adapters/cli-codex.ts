/**
 * Codex CLI adapter — wraps `codex exec` command.
 *
 * Uses OpenAI credentials stored in the Vault.
 * Reads auth.json from the Vault, writing it to a temp
 * directory via HOME override before invocation.
 */

import { BaseCliAdapter, type CliAdapterConfig } from './base-cli-adapter.js';
import type { Vault } from '../vault/vault.js';

const CODEX_CONFIG: CliAdapterConfig = {
  id: 'codex-cli',
  name: 'Codex CLI',
  cliCommand: 'codex',
  defaultModel: 'gpt-5.4',
  supportsSystemPrompt: false,
  models: [
    { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'codex-cli', maxTokens: 8192 },
    { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', provider: 'codex-cli', maxTokens: 8192 },
    { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', provider: 'codex-cli', maxTokens: 8192 },
  ],
};

export class CodexCliAdapter extends BaseCliAdapter {
  readonly config = CODEX_CONFIG;

  constructor(vault: Vault) {
    super(vault);
  }

  protected buildArgs(model: string, prompt: string): string[] {
    return ['exec', '--model', model, JSON.stringify(prompt)];
  }

  protected parseResponse(output: string): string {
    return output.trim();
  }
}
