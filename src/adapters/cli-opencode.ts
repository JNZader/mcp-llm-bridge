/**
 * OpenCode CLI adapter — wraps `opencode run` command.
 *
 * Uses subscription-based routing through OpenCode's servers.
 * Reads credentials from auth.json stored in the Vault, writing
 * it to a temp directory via XDG_DATA_HOME before invocation.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { Vault } from '../vault/vault.js';

/**
 * Parse OpenCode's newline-delimited JSON output into text + token usage.
 */
function parseOpenCodeOutput(raw: string): { text: string; tokens?: { input?: number; output?: number } } {
  const lines = raw.split('\n').filter(line => line.trim().length > 0);
  const textParts: string[] = [];
  let tokens: { input?: number; output?: number } | undefined;

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event['type'] === 'text') {
        const part = event['part'] as Record<string, unknown> | undefined;
        if (part?.['text']) {
          textParts.push(part['text'] as string);
        }
      } else if (event['type'] === 'step_finish') {
        const part = event['part'] as Record<string, unknown> | undefined;
        if (part?.['tokens']) {
          tokens = part['tokens'] as { input?: number; output?: number };
        }
      }
    } catch { /* skip malformed lines */ }
  }

  return { text: textParts.join(''), tokens };
}

export class CliOpenCodeAdapter implements LLMProvider {
  readonly id = 'opencode-cli';
  readonly name = 'OpenCode CLI';
  readonly type = 'cli' as const;
  readonly models = [
    { id: 'opencode/gpt-5-nano', name: 'GPT-5 Nano (OpenCode)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'opencode/big-pickle', name: 'Big Pickle (OpenCode)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'opencode/mimo-v2-pro-free', name: 'MIMO v2 Pro Free (OpenCode)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'opencode/minimax-m2.5-free', name: 'MiniMax M2.5 Free (OpenCode)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (OpenCode)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4 (OpenCode)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'openai/gpt-5-codex', name: 'GPT-5 Codex (OpenCode)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/claude-sonnet-4.5', name: 'Claude Sonnet 4.5 via Copilot (OpenCode)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gpt-5', name: 'GPT-5 via Copilot (OpenCode)', provider: 'opencode-cli', maxTokens: 8192 },
  ];

  private readonly vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const model = request.model ?? 'opencode/gpt-5-nano';
    const authContent = this.vault.getFile('opencode', 'auth.json', request.project);

    // Build temp dir for auth.json if available
    const tempBase = `/tmp/opencode-auth-${process.pid}-${Date.now()}`;
    const authDir = join(tempBase, 'opencode');

    try {
      // Set up auth.json via XDG_DATA_HOME if available
      const env: Record<string, string> = { ...process.env as Record<string, string> };

      if (authContent) {
        mkdirSync(authDir, { recursive: true, mode: 0o700 });
        writeFileSync(join(authDir, 'auth.json'), authContent, { mode: 0o600 });
        env['XDG_DATA_HOME'] = tempBase;
      }

      const args = ['run', '--model', model, '--format', 'json'];

      const output = execSync(`opencode ${args.join(' ')}`, {
        input: request.prompt,
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });

      const parsed = parseOpenCodeOutput(output);
      const totalTokens = parsed.tokens
        ? (parsed.tokens.input ?? 0) + (parsed.tokens.output ?? 0)
        : 0;

      return {
        text: parsed.text || output.trim(),
        provider: this.id,
        model,
        tokensUsed: totalTokens,
      };
    } catch (error) {
      // If it's an exec error with stdout, try to parse partial output
      const execError = error as { stdout?: string; message?: string };
      if (execError.stdout) {
        const parsed = parseOpenCodeOutput(execError.stdout);
        if (parsed.text) {
          return {
            text: parsed.text,
            provider: this.id,
            model,
            tokensUsed: 0,
          };
        }
      }
      throw new Error(
        `OpenCode CLI failed: ${execError.message ?? String(error)}`,
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
      execSync('opencode --version', { timeout: 5_000, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}
