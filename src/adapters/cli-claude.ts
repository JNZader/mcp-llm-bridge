/**
 * Claude CLI adapter — wraps `claude -p` command.
 *
 * Uses Claude Max subscription credentials stored in the Vault.
 * Reads .credentials.json from the Vault, writing it to a temp
 * directory via HOME override before invocation.
 */

import type { GenerateResponse } from '../core/types.js';
import { BaseCliAdapter, type CliAdapterConfig } from './base-cli-adapter.js';
import type { Vault } from '../vault/vault.js';

const CLAUDE_CONFIG: CliAdapterConfig = {
  id: 'claude-cli',
  name: 'Claude CLI',
  cliCommand: 'claude',
  defaultModel: 'claude-sonnet-4-5',
  supportsSystemPrompt: true,
  models: [
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (Max)', provider: 'claude-cli', maxTokens: 8192 },
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6 (Max)', provider: 'claude-cli', maxTokens: 8192 },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Max)', provider: 'claude-cli', maxTokens: 8192 },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (Max)', provider: 'claude-cli', maxTokens: 8192 },
  ],
};

export class ClaudeCliAdapter extends BaseCliAdapter {
  readonly config = CLAUDE_CONFIG;

  constructor(vault: Vault) {
    super(vault);
  }

  protected buildArgs(model: string, prompt: string, system?: string): string[] {
    const args = ['-p', JSON.stringify(prompt), '--output-format', 'json', '--max-turns', '1', '--model', model];
    if (system) {
      args.push('--system-prompt', JSON.stringify(system));
    }
    return args;
  }

  protected parseResponse(output: string): string {
    const parsed: Record<string, unknown> = JSON.parse(output);
    const content = parsed['content'];
    const firstContent = Array.isArray(content) ? (content[0] as Record<string, unknown> | undefined) : undefined;
    return (parsed['result'] as string | undefined)
      ?? (firstContent?.['text'] as string | undefined)
      ?? output;
  }
}
