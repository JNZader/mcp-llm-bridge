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
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { Vault } from '../vault/vault.js';

export class CodexCliAdapter implements LLMProvider {
  readonly id = 'codex-cli';
  readonly name = 'Codex CLI';
  readonly type = 'cli' as const;
  readonly models = [
    { id: 'codex-mini-latest', name: 'Codex Mini Latest', provider: 'codex-cli', maxTokens: 8192 },
    { id: 'o4-mini', name: 'o4-mini', provider: 'codex-cli', maxTokens: 8192 },
    { id: 'o3', name: 'o3', provider: 'codex-cli', maxTokens: 8192 },
  ];

  private readonly vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const model = request.model ?? 'codex-mini-latest';
    const credContent = this.vault.getFile('codex', 'auth.json', request.project);

    // Build temp dir for auth.json if available
    const tempBase = `/tmp/codex-auth-${process.pid}-${Date.now()}`;
    const codexDir = join(tempBase, '.codex');

    try {
      // Set up auth.json via HOME override if available
      const env: Record<string, string> = { ...process.env as Record<string, string> };

      if (credContent) {
        mkdirSync(codexDir, { recursive: true, mode: 0o700 });
        writeFileSync(join(codexDir, 'auth.json'), credContent, { mode: 0o600 });
        env['HOME'] = tempBase;
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
      // Clean up temp files
      if (existsSync(tempBase)) {
        rmSync(tempBase, { recursive: true, force: true });
      }
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
