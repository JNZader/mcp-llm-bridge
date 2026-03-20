/**
 * Qwen CLI adapter — wraps `qwen -p` command.
 *
 * Uses Alibaba Cloud credentials stored in the Vault.
 * Reads oauth_creds.json from the Vault, writing it to a temp
 * directory via HOME override before invocation.
 *
 * Note: Qwen CLI doesn't support --system-prompt, so system is prepended to prompt.
 */

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { Vault } from '../vault/vault.js';
import { materializeProviderHome } from './cli-home.js';
import { execCliSync, isCliAvailable } from './cli-utils.js';

export class QwenCliAdapter implements LLMProvider {
  readonly id = 'qwen-cli';
  readonly name = 'Qwen CLI';
  readonly type = 'cli' as const;
  readonly models = [
    { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus', provider: 'qwen-cli', maxTokens: 8192 },
    { id: 'qwen-plus', name: 'Qwen Plus', provider: 'qwen-cli', maxTokens: 8192 },
    { id: 'qwen-max', name: 'Qwen Max', provider: 'qwen-cli', maxTokens: 8192 },
    { id: 'qwen-turbo', name: 'Qwen Turbo', provider: 'qwen-cli', maxTokens: 8192 },
  ];

  private readonly vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const model = request.model ?? 'qwen3-coder-plus';
    const providerFiles = this.vault.getProviderFiles('qwen', request.project);
    const hasSettings = providerFiles.some((file) => file.fileName === 'settings.json');
    const hasOauthCreds = providerFiles.some((file) => file.fileName === 'oauth_creds.json');
    const mount = providerFiles.length > 0
      ? materializeProviderHome('qwen', providerFiles)
      : null;

    try {
      const env: Record<string, string> = { ...process.env as Record<string, string> };

      if (providerFiles.length > 0 && (!hasSettings || !hasOauthCreds)) {
        throw new Error('Qwen CLI auth incomplete: upload settings.json and oauth_creds.json');
      }

      if (mount) {
        env['HOME'] = mount.homeDir;
      }

      const fullPrompt = request.system ? `${request.system}\n\n${request.prompt}` : request.prompt;
      const args = ['-p', JSON.stringify(fullPrompt), '--model', model];

      // Use execFileSync instead of execSync with string interpolation
      const output = execCliSync('qwen', args, { env });

      // Try to parse JSON output if available
      try {
        const parsed: Record<string, unknown> = JSON.parse(output);
        const text = (parsed['response'] as string | undefined)
          ?? (parsed['result'] as string | undefined)
          ?? output;
        return {
          text,
          provider: this.id,
          model,
          tokensUsed: 0,
        };
      } catch {
        return { text: output.trim(), provider: this.id, model, tokensUsed: 0 };
      }
    } catch (error) {
      const execError = error as { stdout?: string; message?: string };
      if (execError.stdout?.trim()) {
        return { text: execError.stdout.trim(), provider: this.id, model, tokensUsed: 0 };
      }
      throw new Error(
        `Qwen CLI failed: ${execError.message ?? String(error)}`,
      );
    } finally {
      mount?.cleanup();
    }
  }

  async isAvailable(): Promise<boolean> {
    return isCliAvailable('qwen');
  }
}
