/**
 * NVIDIA NIM API adapter — OpenAI-compatible API with credentials from Vault/env.
 */

import { BaseOpenAICompatibleAdapter } from './base-adapter.js';
import type { Vault } from '../vault/vault.js';

export class NvidiaAdapter extends BaseOpenAICompatibleAdapter {
  readonly id = 'nvidia';
  readonly name = 'NVIDIA NIM';
  readonly baseURL = 'https://integrate.api.nvidia.com/v1';
  protected readonly apiKeyEnv = 'NVIDIA_API_KEY';
  // TODO verificar ids exactos.
  protected readonly declaredModels = [
    { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', provider: 'nvidia', maxTokens: 4096 },
    { id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1', provider: 'nvidia', maxTokens: 4096 },
    { id: 'qwen/qwen2.5-coder-32b-instruct', name: 'Qwen2.5 Coder 32B Instruct', provider: 'nvidia', maxTokens: 4096 },
  ];
  readonly defaultModel = 'meta/llama-3.3-70b-instruct';

  constructor(vault: Vault) {
    super(vault);
  }
}
