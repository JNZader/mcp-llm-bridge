/**
 * SambaNova API adapter — OpenAI-compatible API with credentials from Vault/env.
 */

import { BaseOpenAICompatibleAdapter } from './base-adapter.js';
import type { Vault } from '../vault/vault.js';

export class SambanovaAdapter extends BaseOpenAICompatibleAdapter {
  readonly id = 'sambanova';
  readonly name = 'SambaNova';
  readonly baseURL = 'https://api.sambanova.ai/v1';
  protected readonly apiKeyEnv = 'SAMBANOVA_API_KEY';
  // TODO verificar ids exactos.
  protected readonly declaredModels = [
    { id: 'Meta-Llama-3.3-70B-Instruct', name: 'Meta Llama 3.3 70B Instruct', provider: 'sambanova', maxTokens: 4096 },
    { id: 'DeepSeek-R1', name: 'DeepSeek R1', provider: 'sambanova', maxTokens: 4096 },
    { id: 'Qwen3-32B', name: 'Qwen3 32B', provider: 'sambanova', maxTokens: 4096 },
  ];
  readonly defaultModel = 'Meta-Llama-3.3-70B-Instruct';

  constructor(vault: Vault) {
    super(vault);
  }
}
