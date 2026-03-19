/**
 * Claude CLI adapter — wraps `claude -p` command.
 *
 * Migrated from the original generate.ts CLI adapter.
 */

import { execSync } from 'node:child_process';

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';

export class ClaudeCliAdapter implements LLMProvider {
  readonly id = 'claude-cli';
  readonly name = 'Claude CLI';
  readonly type = 'cli' as const;
  readonly models = [
    { id: 'claude-cli', name: 'Claude (CLI)', provider: 'claude-cli', maxTokens: 8192 },
  ];

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const args = ['-p', JSON.stringify(request.prompt), '--output-format', 'json', '--max-turns', '1'];
    if (request.system) args.push('--system-prompt', JSON.stringify(request.system));

    const output = execSync(`claude ${args.join(' ')}`, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
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
        model: 'claude-cli',
        tokensUsed: (usage?.['total_tokens'] as number) ?? 0,
      };
    } catch {
      return { text: output.trim(), provider: this.id, model: 'claude-cli', tokensUsed: 0 };
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
