/**
 * OpenRouter API adapter — OpenAI-compatible API with credentials from Vault.
 *
 * OpenRouter aggregates many providers behind a single API. We reuse the
 * `openai` SDK with a custom base URL and an HTTP-Referer header.
 */

import { BaseOpenAICompatibleAdapter } from './base-adapter.js';
import type { Vault } from '../vault/vault.js';

export class OpenRouterAdapter extends BaseOpenAICompatibleAdapter {
  readonly id = 'openrouter';
  readonly name = 'OpenRouter';
  readonly baseURL = 'https://openrouter.ai/api/v1';
  readonly models = [
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', provider: 'openrouter', maxTokens: 4096 },
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'openrouter', maxTokens: 4096 },
    { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openrouter', maxTokens: 4096 },
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'openrouter', maxTokens: 4096 },
  ];
  readonly defaultModel = 'deepseek/deepseek-chat';
  readonly defaultHeaders = {
    'HTTP-Referer': 'https://github.com/JNZader/mcp-llm-bridge',
  };

  constructor(vault: Vault) {
    super(vault);
  }
}
