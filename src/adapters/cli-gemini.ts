/**
 * Gemini CLI adapter — wraps `gemini -p` command.
 *
 * Uses Google account credentials stored in the Vault.
 * Reads oauth_creds.json from the Vault, writing it to a temp
 * directory via HOME override before invocation.
 *
 * Note: Gemini CLI doesn't support --system-prompt, so system is prepended to prompt.
 */

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { Vault } from '../vault/vault.js';
import { materializeProviderHome } from './cli-home.js';
import { execCliSync, isCliAvailable } from './cli-utils.js';

export class GeminiCliAdapter implements LLMProvider {
  readonly id = 'gemini-cli';
  readonly name = 'Gemini CLI';
  readonly type = 'cli' as const;
  readonly models = [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini-cli', maxTokens: 8192 },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'gemini-cli', maxTokens: 8192 },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini-cli', maxTokens: 8192 },
  ];

  private readonly vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const model = request.model ?? 'gemini-2.5-flash';
    const providerFiles = this.vault.getProviderFiles('gemini', request.project);
    const hasSettings = providerFiles.some((file) => file.fileName === 'settings.json');
    const hasOauthCreds = providerFiles.some((file) => file.fileName === 'oauth_creds.json');
    const mount = providerFiles.length > 0
      ? materializeProviderHome('gemini', providerFiles)
      : null;

    try {
      const env: Record<string, string> = { ...process.env as Record<string, string> };

      if (providerFiles.length > 0 && (!hasSettings || !hasOauthCreds)) {
        throw new Error('Gemini CLI auth incomplete: upload settings.json and oauth_creds.json');
      }

      if (mount) {
        env['HOME'] = mount.homeDir;
      }

      const fullPrompt = request.system ? `${request.system}\n\n${request.prompt}` : request.prompt;
      const args = ['-p', JSON.stringify(fullPrompt), '--output-format', 'json', '--model', model];

      // Use execFileSync instead of execSync with string interpolation
      const output = execCliSync('gemini', args, { env });

      try {
        const parsed: Record<string, unknown> = JSON.parse(output);
        return {
          text: (parsed['response'] as string | undefined) ?? output,
          provider: this.id,
          model,
          tokensUsed: 0,
        };
      } catch {
        return { text: output.trim(), provider: this.id, model, tokensUsed: 0 };
      }
    } catch (error) {
      const execError = error as { stdout?: string; message?: string };
      if (execError.stdout) {
        try {
          const parsed: Record<string, unknown> = JSON.parse(execError.stdout);
          const text = parsed['response'] as string | undefined;
          if (text) {
            return { text, provider: this.id, model, tokensUsed: 0 };
          }
        } catch { /* ignore parse errors */ }
      }
      throw new Error(
        `Gemini CLI failed: ${execError.message ?? String(error)}`,
      );
    } finally {
      mount?.cleanup();
    }
  }

  async isAvailable(): Promise<boolean> {
    return isCliAvailable('gemini');
  }
}
