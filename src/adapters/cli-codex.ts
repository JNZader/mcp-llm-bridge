/**
 * Codex CLI adapter — wraps `codex exec` command.
 *
 * Migrated from the original generate.ts CLI adapter.
 * Note: Codex doesn't support a system prompt flag; system is prepended to prompt.
 */

import { execSync } from 'node:child_process';

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';

export class CodexCliAdapter implements LLMProvider {
  readonly id = 'codex-cli';
  readonly name = 'Codex CLI';
  readonly type = 'cli' as const;
  readonly models = [
    { id: 'codex-cli', name: 'Codex (CLI)', provider: 'codex-cli', maxTokens: 8192 },
  ];

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const fullPrompt = request.system ? `${request.system}\n\n${request.prompt}` : request.prompt;

    const output = execSync(`codex exec ${JSON.stringify(fullPrompt)}`, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return { text: output.trim(), provider: this.id, model: 'codex-cli', tokensUsed: 0 };
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
