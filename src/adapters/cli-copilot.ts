/**
 * Copilot CLI adapter — wraps `copilot -p` command.
 *
 * Migrated from the original generate.ts CLI adapter.
 * Note: Copilot doesn't support system prompt, JSON output, or stdin prompts.
 * Prompts larger than MAX_COPILOT_ARGV_PROMPT_CHARS are refused so a legal
 * RAG payload is never interpolated onto argv.
 */

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { Vault } from '../vault/vault.js';
import {
  execCliSync,
  isCliAvailableAsync,
  MAX_COPILOT_ARGV_PROMPT_CHARS,
} from './cli-utils.js';

export class CopilotCliAdapter implements LLMProvider {
  readonly id = 'copilot-cli';
  readonly name = 'Copilot CLI';
  readonly type = 'cli' as const;
  readonly models = [
    { id: 'gpt-4.1', name: 'GPT-4.1 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5-mini', name: 'GPT-5 Mini (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5.1', name: 'GPT-5.1 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5.2', name: 'GPT-5.2 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5.4', name: 'GPT-5.4 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'claude-sonnet-4', name: 'Claude Sonnet 4 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'claude-opus-4.5', name: 'Claude Opus 4.5 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'claude-opus-4.6', name: 'Claude Opus 4.6 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'claude-opus-4.6-fast', name: 'Claude Opus 4.6 Fast (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
  ];

  private readonly vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const model = request.model ?? 'gpt-4.1';
    const fullPrompt = request.system ? `${request.system}\n\n${request.prompt}` : request.prompt;
    if (fullPrompt.length > MAX_COPILOT_ARGV_PROMPT_CHARS) {
      throw new Error(
        `Copilot CLI refuses prompts over ${MAX_COPILOT_ARGV_PROMPT_CHARS} characters on argv; use a stdin-capable provider such as opencode-cli`,
      );
    }
    const env: Record<string, string> = { ...process.env as Record<string, string> };

    try {
      const token = this.vault.getDecrypted('copilot', 'default', request.project);
      env['COPILOT_GITHUB_TOKEN'] = token;
      env['GH_TOKEN'] = token;
      env['GITHUB_TOKEN'] = token;
    } catch {
      // Fall back to any local environment auth already present.
    }

    // Copilot has no stdin prompt path (`-p/--prompt <text>` is required for
    // non-interactive mode). Small prompts stay on `-p`; large ones are refused
    // above so a 37k legal RAG payload never lands in argv / process lists.
    const output = execCliSync(
      'copilot',
      ['-p', fullPrompt, '--model', model, '--allow-all-tools'],
      { env },
    );

    return { text: output.trim(), provider: this.id, model, tokensUsed: 0, resolvedProvider: this.id, resolvedModel: model, fallbackUsed: false };
  }

  async isAvailable(): Promise<boolean> {
    return isCliAvailableAsync('copilot');
  }
}
