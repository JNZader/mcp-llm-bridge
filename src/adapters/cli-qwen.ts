/**
 * Qwen CLI adapter — wraps `qwen -p` command.
 *
 * Uses Alibaba Cloud credentials stored in the Vault.
 * Reads oauth_creds.json from the Vault, writing it to a temp
 * directory via HOME override before invocation.
 *
 * Note: Qwen CLI doesn't support --system-prompt, so system is prepended to prompt.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { Vault } from '../vault/vault.js';

export class QwenCliAdapter implements LLMProvider {
  readonly id = 'qwen-cli';
  readonly name = 'Qwen CLI';
  readonly type = 'cli' as const;
  readonly models = [
    { id: 'qwen-coder-plus', name: 'Qwen Coder Plus', provider: 'qwen-cli', maxTokens: 8192 },
    { id: 'qwen-plus', name: 'Qwen Plus', provider: 'qwen-cli', maxTokens: 8192 },
    { id: 'qwen-max', name: 'Qwen Max', provider: 'qwen-cli', maxTokens: 8192 },
    { id: 'qwen-turbo', name: 'Qwen Turbo', provider: 'qwen-cli', maxTokens: 8192 },
  ];

  private readonly vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const model = request.model ?? 'qwen-coder-plus';
    const credContent = this.vault.getFile('qwen', 'oauth_creds.json', request.project);

    // Build temp dir for oauth_creds.json if available
    const tempBase = `/tmp/qwen-auth-${process.pid}-${Date.now()}`;
    const qwenDir = join(tempBase, '.qwen');

    try {
      // Set up oauth_creds.json via HOME override if available
      const env: Record<string, string> = { ...process.env as Record<string, string> };

      if (credContent) {
        mkdirSync(qwenDir, { recursive: true, mode: 0o700 });
        writeFileSync(join(qwenDir, 'oauth_creds.json'), credContent, { mode: 0o600 });
        env['HOME'] = tempBase;
      }

      const fullPrompt = request.system ? `${request.system}\n\n${request.prompt}` : request.prompt;
      const args = ['-p', JSON.stringify(fullPrompt), '--model', model];

      const output = execSync(`qwen ${args.join(' ')}`, {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });

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
      // Clean up temp files
      if (existsSync(tempBase)) {
        rmSync(tempBase, { recursive: true, force: true });
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      execSync('qwen --version', { timeout: 5_000, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}
