/**
 * OpenAI API adapter — uses the official SDK with credentials from Vault.
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { Vault } from '../vault/vault.js';

export class OpenAIAdapter implements LLMProvider {
  readonly id = 'openai';
  readonly name = 'OpenAI';
  readonly type = 'api' as const;
  readonly models = [
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', maxTokens: 4096 },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', maxTokens: 4096 },
    { id: 'o3-mini', name: 'o3-mini', provider: 'openai', maxTokens: 4096 },
  ];

  constructor(private readonly vault: Vault) {}

  // Client cache per apiKey to avoid recreating connections
  private clientCache = new Map<string, OpenAI>();

  /**
   * Get or create a cached OpenAI client for the given apiKey.
   */
  private getClient(apiKey: string): OpenAI {
    if (!this.clientCache.has(apiKey)) {
      this.clientCache.set(apiKey, new OpenAI({ apiKey }));
    }
    return this.clientCache.get(apiKey)!;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const apiKey = this.vault.getDecrypted('openai', 'default', request.project);
    const client = this.getClient(apiKey);

    const model = request.model ?? 'gpt-4o';
    const messages: ChatCompletionMessageParam[] = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content: request.prompt });

    const response = await client.chat.completions.create({
      model,
      max_tokens: request.maxTokens ?? 4096,
      messages,
    });

    return {
      text: response.choices[0]?.message?.content ?? '',
      provider: this.id,
      model,
      tokensUsed: response.usage?.total_tokens ?? undefined,
      resolvedProvider: this.id,
      resolvedModel: model,
      fallbackUsed: false,
    };
  }

  async isAvailable(): Promise<boolean> {
    return this.vault.has('openai');
  }
}
