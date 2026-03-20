/**
 * Groq API adapter — OpenAI-compatible API with credentials from Vault.
 *
 * Groq exposes an OpenAI-compatible endpoint, so we reuse the `openai` SDK
 * with a custom base URL pointing to Groq's API.
 */

import { BaseOpenAICompatibleAdapter } from './base-adapter.js';
import type { Vault } from '../vault/vault.js';

export class GroqAdapter extends BaseOpenAICompatibleAdapter {
  readonly id = 'groq';
  readonly name = 'Groq';
  readonly baseURL = 'https://api.groq.com/openai/v1';
  readonly models = [
    { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'groq', maxTokens: 4096 },
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', provider: 'groq', maxTokens: 4096 },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', provider: 'groq', maxTokens: 4096 },
  ];
  readonly defaultModel = 'llama-3.3-70b-versatile';

  constructor(vault: Vault) {
    super(vault);
  }
}
