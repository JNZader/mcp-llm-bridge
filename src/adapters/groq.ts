/**
 * Groq API adapter — OpenAI-compatible API with credentials from Vault.
 *
 * Groq exposes an OpenAI-compatible endpoint, so we reuse the `openai` SDK
 * with a custom base URL pointing to Groq's API.
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { Vault } from '../vault/vault.js';

export class GroqAdapter implements LLMProvider {
  readonly id = 'groq';
  readonly name = 'Groq';
  readonly type = 'api' as const;
  readonly models = [
    { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'groq', maxTokens: 4096 },
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', provider: 'groq', maxTokens: 4096 },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', provider: 'groq', maxTokens: 4096 },
  ];

  constructor(private readonly vault: Vault) {}

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const apiKey = this.vault.getDecrypted('groq');
    const client = new OpenAI({
      apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    });

    const model = request.model ?? 'llama-3.3-70b-versatile';
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
    };
  }

  async isAvailable(): Promise<boolean> {
    return this.vault.has('groq');
  }
}
