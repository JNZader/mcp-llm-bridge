/**
 * Hyperbolic API adapter — OpenAI-compatible API with credentials from Vault/env.
 */

import { BaseOpenAICompatibleAdapter } from './base-adapter.js';
import type { Vault } from '../vault/vault.js';

export class HyperbolicAdapter extends BaseOpenAICompatibleAdapter {
  readonly id = 'hyperbolic';
  readonly name = 'Hyperbolic';
  readonly baseURL = 'https://api.hyperbolic.xyz/v1';
  protected readonly apiKeyEnv = 'HYPERBOLIC_API_KEY';
  // TODO verificar ids exactos.
  protected readonly declaredModels = [
    { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B Instruct', provider: 'hyperbolic', maxTokens: 4096 },
    { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1', provider: 'hyperbolic', maxTokens: 4096 },
  ];
  readonly defaultModel = 'meta-llama/Llama-3.3-70B-Instruct';

  constructor(vault: Vault) {
    super(vault);
  }
}
