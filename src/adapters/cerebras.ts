/**
 * Cerebras API adapter — OpenAI-compatible API with credentials from Vault/env.
 */

import { BaseOpenAICompatibleAdapter } from './base-adapter.js';
import type { Vault } from '../vault/vault.js';

export class CerebrasAdapter extends BaseOpenAICompatibleAdapter {
  readonly id = 'cerebras';
  readonly name = 'Cerebras';
  readonly baseURL = 'https://api.cerebras.ai/v1';
  protected readonly apiKeyEnv = 'CEREBRAS_API_KEY';
  // TODO verificar ids exactos.
  protected readonly declaredModels = [
    { id: 'gpt-oss-120b', name: 'GPT OSS 120B', provider: 'cerebras', maxTokens: 4096 },
    { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', provider: 'cerebras', maxTokens: 4096 },
    { id: 'zai-glm-4.7', name: 'ZAI GLM 4.7', provider: 'cerebras', maxTokens: 4096 },
  ];
  readonly defaultModel = 'gpt-oss-120b';

  constructor(vault: Vault) {
    super(vault);
  }
}
