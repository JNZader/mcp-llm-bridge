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
import { CerebrasAdapter } from './cerebras.js';
import { ZaiAdapter } from './zai.js';
import { NvidiaAdapter } from './nvidia.js';
import { MistralAdapter } from './mistral.js';
import { SambanovaAdapter } from './sambanova.js';
import { HyperbolicAdapter } from './hyperbolic.js';
import { CliOpenCodeAdapter } from './cli-opencode.js';
import { ClaudeCliAdapter } from './cli-claude.js';
import { AntigravityCliAdapter } from './cli-antigravity.js';
import { CodexCliAdapter } from './cli-codex.js';
import { QwenCliAdapter } from './cli-qwen.js';
import { CopilotCliAdapter } from './cli-copilot.js';

export {
  AnthropicAdapter,
  OpenAIAdapter,
  GoogleAdapter,
  GroqAdapter,
  OpenRouterAdapter,
  CerebrasAdapter,
  ZaiAdapter,
  NvidiaAdapter,
  MistralAdapter,
  SambanovaAdapter,
  HyperbolicAdapter,
  CliOpenCodeAdapter,
  ClaudeCliAdapter,
  AntigravityCliAdapter,
  CodexCliAdapter,
  QwenCliAdapter,
  CopilotCliAdapter,
};

export { LocalLLMProvider } from '../local-llm/provider.js';

export { parseOpenCodeModelsList, parseOpenCodeOutput } from './cli-opencode.js';

/**
 * Create all available provider adapters.
 *
 * API adapters (Anthropic, OpenAI, Google, Groq, OpenRouter, Cerebras, Z.AI,
 * NVIDIA, Mistral, SambaNova, Hyperbolic) receive the
 * Vault for credential retrieval. CLI adapters (OpenCode, Claude, Gemini,
 * Codex, Qwen, Copilot) also receive the Vault for auth material access.
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
    new CerebrasAdapter(vault),
    new ZaiAdapter(vault),
    new NvidiaAdapter(vault),
    new MistralAdapter(vault),
    new SambanovaAdapter(vault),
    new HyperbolicAdapter(vault),
    new CliOpenCodeAdapter(vault),
    new ClaudeCliAdapter(vault),
    new AntigravityCliAdapter(vault),
    new CodexCliAdapter(vault),
    new QwenCliAdapter(vault),
    new CopilotCliAdapter(vault),
  ];
}
