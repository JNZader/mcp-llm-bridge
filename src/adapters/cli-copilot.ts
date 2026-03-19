/**
 * Copilot CLI adapter — wraps `copilot -p` command.
 *
 * Migrated from the original generate.ts CLI adapter.
 * Note: Copilot doesn't support system prompt or JSON output.
 */

import { execSync } from 'node:child_process';

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';

export class CopilotCliAdapter implements LLMProvider {
  readonly id = 'copilot-cli';
  readonly name = 'Copilot CLI';
  readonly type = 'cli' as const;
  readonly models = [
    { id: 'copilot-cli', name: 'Copilot (CLI)', provider: 'copilot-cli', maxTokens: 8192 },
  ];

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const output = execSync(`copilot -p ${JSON.stringify(request.prompt)} --allow-all-tools`, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return { text: output.trim(), provider: this.id, model: 'copilot-cli', tokensUsed: 0 };
  }

  async isAvailable(): Promise<boolean> {
    try {
      execSync('copilot --version', { timeout: 5_000, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}
