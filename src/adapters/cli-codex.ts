/**
 * Codex CLI adapter — wraps `codex exec` command.
 *
 * Uses OpenAI credentials stored in the Vault.
 * Reads auth.json from the Vault, writing it to a temp
 * directory via HOME override before invocation.
 *
 * Note: Codex doesn't support a system prompt flag; system is prepended to prompt.
 */

import { execSync } from 'node:child_process';

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { Vault } from '../vault/vault.js';
import { materializeProviderHome } from './cli-home.js';

export class CodexCliAdapter implements LLMProvider {
  readonly id = 'codex-cli';
  readonly name = 'Codex CLI';
  readonly type = 'cli' as const;
  readonly models = [
    { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'codex-cli', maxTokens: 8192 },
    { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', provider: 'codex-cli', maxTokens: 8192 },
    { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', provider: 'codex-cli', maxTokens: 8192 },
  ];

  private readonly vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const model = request.model ?? 'gpt-5.4';
    const providerFiles = this.vault.getProviderFiles('codex', request.project);
    const mount = providerFiles.length > 0
      ? materializeProviderHome('codex', providerFiles)
      : null;

    try {
      const env: Record<string, string> = { ...process.env as Record<string, string> };

      if (mount) {
        env['HOME'] = mount.homeDir;
      }

      const fullPrompt = request.system ? `${request.system}\n\n${request.prompt}` : request.prompt;

      const output = execSync(`codex exec --model ${model} ${JSON.stringify(fullPrompt)}`, {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });

      return { text: output.trim(), provider: this.id, model, tokensUsed: 0 };
    } catch (error) {
      const execError = error as { stdout?: string; message?: string };
      if (execError.stdout?.trim()) {
        return { text: execError.stdout.trim(), provider: this.id, model, tokensUsed: 0 };
      }
      throw new Error(
        `Codex CLI failed: ${execError.message ?? String(error)}`,
      );
    } finally {
      mount?.cleanup();
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      execSync('codex --version', { timeout: 5_000, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}
