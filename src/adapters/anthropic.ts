/**
 * Anthropic API adapter — uses the official SDK with credentials from Vault.
 */

import Anthropic from '@anthropic-ai/sdk';

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { Vault } from '../vault/vault.js';

export class AnthropicAdapter implements LLMProvider {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';
  readonly type = 'api' as const;
  readonly models = [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', maxTokens: 8192 },
    { id: 'claude-haiku-4-20250414', name: 'Claude Haiku 4', provider: 'anthropic', maxTokens: 8192 },
  ];

  constructor(private readonly vault: Vault) {}

  // Client cache per apiKey to avoid recreating connections
  private clientCache = new Map<string, Anthropic>();

  /**
   * Get or create a cached Anthropic client for the given apiKey.
   */
  private getClient(apiKey: string): Anthropic {
    if (!this.clientCache.has(apiKey)) {
      this.clientCache.set(apiKey, new Anthropic({ apiKey }));
    }
    return this.clientCache.get(apiKey)!;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const apiKey = this.vault.getDecrypted('anthropic', 'default', request.project);
    const client = this.getClient(apiKey);

    const model = request.model ?? 'claude-sonnet-4-20250514';
    const response = await client.messages.create({
      model,
      max_tokens: request.maxTokens ?? 4096,
      system: request.system ?? '',
      messages: [{ role: 'user', content: request.prompt }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    return {
      text,
      provider: this.id,
      model,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    };
  }

  async isAvailable(): Promise<boolean> {
    return this.vault.has('anthropic');
  }
}
