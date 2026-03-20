/**
 * Claude CLI adapter — wraps `claude -p` command.
 *
 * Uses Claude Max subscription credentials stored in the Vault.
 * Reads .credentials.json from the Vault, writing it to a temp
 * directory via HOME override before invocation.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { Vault } from '../vault/vault.js';

export class ClaudeCliAdapter implements LLMProvider {
  readonly id = 'claude-cli';
  readonly name = 'Claude CLI';
  readonly type = 'cli' as const;
  readonly models = [
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (Max)', provider: 'claude-cli', maxTokens: 8192 },
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6 (Max)', provider: 'claude-cli', maxTokens: 8192 },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Max)', provider: 'claude-cli', maxTokens: 8192 },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (Max)', provider: 'claude-cli', maxTokens: 8192 },
  ];

  private readonly vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const model = request.model ?? 'claude-sonnet-4-5';
    const credContent = this.vault.getFile('claude', '.credentials.json', request.project);

    // Build temp dir for .credentials.json if available
    const tempBase = `/tmp/claude-auth-${process.pid}-${Date.now()}`;
    const claudeDir = join(tempBase, '.claude');

    try {
      // Set up .credentials.json via HOME override if available
      const env: Record<string, string> = { ...process.env as Record<string, string> };

      if (credContent) {
        mkdirSync(claudeDir, { recursive: true, mode: 0o700 });
        writeFileSync(join(claudeDir, '.credentials.json'), credContent, { mode: 0o600 });
        env['HOME'] = tempBase;
      }

      const args = ['-p', JSON.stringify(request.prompt), '--output-format', 'json', '--max-turns', '1', '--model', model];
      if (request.system) args.push('--system-prompt', JSON.stringify(request.system));

      const output = execSync(`claude ${args.join(' ')}`, {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });

      try {
        const parsed: Record<string, unknown> = JSON.parse(output);
        const content = parsed['content'];
        const firstContent = Array.isArray(content) ? (content[0] as Record<string, unknown> | undefined) : undefined;
        const text = (parsed['result'] as string | undefined)
          ?? (firstContent?.['text'] as string | undefined)
          ?? output;
        const usage = parsed['usage'] as Record<string, unknown> | undefined;
        return {
          text,
          provider: this.id,
          model,
          tokensUsed: (usage?.['total_tokens'] as number) ?? 0,
        };
      } catch {
        return { text: output.trim(), provider: this.id, model, tokensUsed: 0 };
      }
    } catch (error) {
      const execError = error as { stdout?: string; message?: string };
      if (execError.stdout) {
        try {
          const parsed: Record<string, unknown> = JSON.parse(execError.stdout);
          const content = parsed['content'];
          const firstContent = Array.isArray(content) ? (content[0] as Record<string, unknown> | undefined) : undefined;
          const text = (parsed['result'] as string | undefined)
            ?? (firstContent?.['text'] as string | undefined);
          if (text) {
            return { text, provider: this.id, model, tokensUsed: 0 };
          }
        } catch { /* ignore parse errors */ }
      }
      throw new Error(
        `Claude CLI failed: ${execError.message ?? String(error)}`,
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
      execSync('claude --version', { timeout: 5_000, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}
