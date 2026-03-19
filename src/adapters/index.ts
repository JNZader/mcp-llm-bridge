/**
 * Adapter registry — exports all provider adapters and a factory function.
 */

import type { LLMProvider } from '../core/types.js';
import type { Vault } from '../vault/vault.js';

import { AnthropicAdapter } from './anthropic.js';
import { OpenAIAdapter } from './openai.js';
import { GoogleAdapter } from './google.js';
import { GroqAdapter } from './groq.js';
import { OpenRouterAdapter } from './openrouter.js';
import { ClaudeCliAdapter } from './cli-claude.js';
import { GeminiCliAdapter } from './cli-gemini.js';
import { CodexCliAdapter } from './cli-codex.js';
import { CopilotCliAdapter } from './cli-copilot.js';

export {
  AnthropicAdapter,
  OpenAIAdapter,
  GoogleAdapter,
  GroqAdapter,
  OpenRouterAdapter,
  ClaudeCliAdapter,
  GeminiCliAdapter,
  CodexCliAdapter,
  CopilotCliAdapter,
};

/**
 * Create all available provider adapters.
 *
 * API adapters (Anthropic, OpenAI, Google, Groq, OpenRouter) receive the
 * Vault for credential retrieval. CLI adapters are standalone — they rely
 * on CLI authentication.
 *
 * Order: API adapters first (by priority), then CLI adapters.
 */
export function createAllAdapters(vault: Vault): LLMProvider[] {
  return [
    new AnthropicAdapter(vault),
    new OpenAIAdapter(vault),
    new GoogleAdapter(vault),
    new GroqAdapter(vault),
    new OpenRouterAdapter(vault),
    new ClaudeCliAdapter(),
    new GeminiCliAdapter(),
    new CodexCliAdapter(),
    new CopilotCliAdapter(),
  ];
}
