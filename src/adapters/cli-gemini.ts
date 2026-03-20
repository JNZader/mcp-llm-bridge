/**
 * Gemini CLI adapter — wraps `gemini -p` command.
 *
 * Uses Google account credentials stored in the Vault.
 * Reads oauth_creds.json from the Vault, writing it to a temp
 * directory via HOME override before invocation.
 */

import type { GenerateResponse } from '../core/types.js';
import { BaseCliAdapter, type CliAdapterConfig } from './base-cli-adapter.js';
import type { Vault } from '../vault/vault.js';

const GEMINI_CONFIG: CliAdapterConfig = {
  id: 'gemini-cli',
  name: 'Gemini CLI',
  cliCommand: 'gemini',
  defaultModel: 'gemini-2.5-flash',
  supportsSystemPrompt: false,
  models: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini-cli', maxTokens: 8192 },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'gemini-cli', maxTokens: 8192 },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini-cli', maxTokens: 8192 },
  ],
};

export class GeminiCliAdapter extends BaseCliAdapter {
  readonly config = GEMINI_CONFIG;

  constructor(vault: Vault) {
    super(vault);
  }

  protected buildArgs(model: string, prompt: string): string[] {
    return ['-p', JSON.stringify(prompt), '--output-format', 'json', '--model', model];
  }

  protected parseResponse(output: string): string {
    const parsed: Record<string, unknown> = JSON.parse(output);
    return (parsed['response'] as string | undefined) ?? output;
  }

  protected validateProviderFiles(files: Array<{ fileName: string }>): void {
    const hasSettings = files.some((file) => file.fileName === 'settings.json');
    const hasOauthCreds = files.some((file) => file.fileName === 'oauth_creds.json');
    
    if (!hasSettings || !hasOauthCreds) {
      throw new Error('Gemini CLI auth incomplete: upload settings.json and oauth_creds.json');
    }
  }
}
