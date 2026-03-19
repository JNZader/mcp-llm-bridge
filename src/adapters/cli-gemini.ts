/**
 * Gemini CLI adapter — wraps `gemini -p` command.
 *
 * Migrated from the original generate.ts CLI adapter.
 * Note: Gemini CLI doesn't support --system-prompt, so system is prepended to prompt.
 */

import { execSync } from 'node:child_process';

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';

export class GeminiCliAdapter implements LLMProvider {
  readonly id = 'gemini-cli';
  readonly name = 'Gemini CLI';
  readonly type = 'cli' as const;
  readonly models = [
    { id: 'gemini-cli', name: 'Gemini (CLI)', provider: 'gemini-cli', maxTokens: 8192 },
  ];

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const fullPrompt = request.system ? `${request.system}\n\n${request.prompt}` : request.prompt;
    const args = ['-p', JSON.stringify(fullPrompt), '--output-format', 'json'];

    const output = execSync(`gemini ${args.join(' ')}`, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    try {
      const parsed: Record<string, unknown> = JSON.parse(output);
      return {
        text: (parsed['response'] as string | undefined) ?? output,
        provider: this.id,
        model: 'gemini-cli',
        tokensUsed: 0,
      };
    } catch {
      return { text: output.trim(), provider: this.id, model: 'gemini-cli', tokensUsed: 0 };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      execSync('gemini --version', { timeout: 5_000, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}
