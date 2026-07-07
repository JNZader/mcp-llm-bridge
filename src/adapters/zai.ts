/**
 * Z.AI API adapter — OpenAI-compatible API with credentials from Vault/env.
 */

import { BaseOpenAICompatibleAdapter } from './base-adapter.js';
import type { Vault } from '../vault/vault.js';

export class ZaiAdapter extends BaseOpenAICompatibleAdapter {
  readonly id = 'zai';
  readonly name = 'Z.AI';
  readonly baseURL = 'https://api.z.ai/api/paas/v4';
  protected readonly apiKeyEnv = 'ZAI_API_KEY';
  protected readonly declaredModels = [
    { id: 'glm-4.6', name: 'GLM 4.6', provider: 'zai', maxTokens: 4096 },
    { id: 'glm-4.5-air', name: 'GLM 4.5 Air', provider: 'zai', maxTokens: 4096 },
    { id: 'glm-4.5-flash', name: 'GLM 4.5 Flash', provider: 'zai', maxTokens: 4096 },
  ];
  readonly defaultModel = 'glm-4.6';

  constructor(vault: Vault) {
    super(vault);
  }
}
