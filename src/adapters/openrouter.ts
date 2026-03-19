/**
 * OpenRouter API adapter — OpenAI-compatible API with credentials from Vault.
 *
 * OpenRouter aggregates many providers behind a single API. We reuse the
 * `openai` SDK with a custom base URL and an HTTP-Referer header.
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { Vault } from '../vault/vault.js';

export class OpenRouterAdapter implements LLMProvider {
  readonly id = 'openrouter';
  readonly name = 'OpenRouter';
  readonly type = 'api' as const;
  readonly models = [
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', provider: 'openrouter', maxTokens: 4096 },
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'openrouter', maxTokens: 4096 },
    { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openrouter', maxTokens: 4096 },
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'openrouter', maxTokens: 4096 },
  ];

  constructor(private readonly vault: Vault) {}

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const apiKey = this.vault.getDecrypted('openrouter');
    const client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/JNZader/mcp-llm-bridge',
      },
    });

    const model = request.model ?? 'deepseek/deepseek-chat';
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
    return this.vault.has('openrouter');
  }
}
