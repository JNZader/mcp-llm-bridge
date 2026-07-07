/**
 * Mistral API adapter — OpenAI-compatible API with credentials from Vault/env.
 */

import { BaseOpenAICompatibleAdapter } from './base-adapter.js';
import type { Vault } from '../vault/vault.js';

export class MistralAdapter extends BaseOpenAICompatibleAdapter {
  readonly id = 'mistral';
  readonly name = 'Mistral';
  readonly baseURL = 'https://api.mistral.ai/v1';
  protected readonly apiKeyEnv = 'MISTRAL_API_KEY';
  protected readonly declaredModels = [
    { id: 'mistral-small-latest', name: 'Mistral Small Latest', provider: 'mistral', maxTokens: 4096 },
    { id: 'codestral-latest', name: 'Codestral Latest', provider: 'mistral', maxTokens: 4096 },
    { id: 'open-mistral-nemo', name: 'Open Mistral Nemo', provider: 'mistral', maxTokens: 4096 },
  ];
  readonly defaultModel = 'mistral-small-latest';

  constructor(vault: Vault) {
    super(vault);
  }
}
