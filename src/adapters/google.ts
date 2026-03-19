/**
 * Google (Gemini) API adapter — OpenAI-compatible API with credentials from Vault.
 *
 * Google exposes an OpenAI-compatible endpoint for Gemini models at
 * generativelanguage.googleapis.com. We reuse the `openai` SDK with
 * a custom base URL.
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { Vault } from '../vault/vault.js';

export class GoogleAdapter implements LLMProvider {
  readonly id = 'google';
  readonly name = 'Google';
  readonly type = 'api' as const;
  readonly models = [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', maxTokens: 8192 },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', maxTokens: 8192 },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google', maxTokens: 8192 },
  ];

  constructor(private readonly vault: Vault) {}

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const apiKey = this.vault.getDecrypted('google');
    const client = new OpenAI({
      apiKey,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    });

    const model = request.model ?? 'gemini-2.5-flash';
    const messages: ChatCompletionMessageParam[] = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content: request.prompt });

    const response = await client.chat.completions.create({
      model,
      max_tokens: request.maxTokens ?? 8192,
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
    return this.vault.has('google');
  }
}
