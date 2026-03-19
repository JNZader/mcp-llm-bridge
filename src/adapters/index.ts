/**
 * Adapter registry — exports all provider adapters and a factory function.
 */

import type { LLMProvider } from '../core/types.js';
import type { Vault } from '../vault/vault.js';

import { AnthropicAdapter } from './anthropic.js';
import { OpenAIAdapter } from './openai.js';
import { ClaudeCliAdapter } from './cli-claude.js';
import { GeminiCliAdapter } from './cli-gemini.js';
import { CodexCliAdapter } from './cli-codex.js';
import { CopilotCliAdapter } from './cli-copilot.js';

export {
  AnthropicAdapter,
  OpenAIAdapter,
  ClaudeCliAdapter,
  GeminiCliAdapter,
  CodexCliAdapter,
  CopilotCliAdapter,
};

/**
 * Create all available provider adapters.
 *
 * API adapters (Anthropic, OpenAI) receive the Vault for credential retrieval.
 * CLI adapters are standalone — they rely on CLI authentication.
 */
export function createAllAdapters(vault: Vault): LLMProvider[] {
  return [
    new AnthropicAdapter(vault),
    new OpenAIAdapter(vault),
    new ClaudeCliAdapter(),
    new GeminiCliAdapter(),
    new CodexCliAdapter(),
    new CopilotCliAdapter(),
  ];
}
