/**
 * Anthropic API adapter — uses the official SDK with credentials from Vault.
 *
 * Supports two authentication modes:
 * 1. OAuth token from Claude CLI (~/.claude/.credentials.json)
 * 2. API key stored in the encrypted Vault
 *
 * OAuth is preferred when available as it supports Pro/Max subscriptions.
 */

import Anthropic from '@anthropic-ai/sdk';

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { Vault } from '../vault/vault.js';

/** Auth mode for the Anthropic client. */
type AuthMode = { type: 'oauth'; token: string } | { type: 'api-key'; key: string };

export class AnthropicAdapter implements LLMProvider {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';
  readonly type = 'api' as const;
  readonly models = [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', maxTokens: 8192 },
    { id: 'claude-haiku-4-20250414', name: 'Claude Haiku 4', provider: 'anthropic', maxTokens: 8192 },
  ];

  constructor(private readonly vault: Vault) {}

  // Client cache per auth mode to avoid recreating connections
  private clientCache = new Map<string, Anthropic>();

  /**
   * Determine the auth mode to use.
   *
   * Priority:
   * 1. OAuth token from Claude CLI (preferred for Pro/Max)
   * 2. API key from Vault
   *
   * @param project - Optional project scope
   * @returns Auth mode to use
   */
  private async getAuthMode(project?: string): Promise<AuthMode> {
    // Try OAuth first
    const oauthToken = await this.vault.getClaudeOAuthToken(project);
    if (oauthToken?.accessToken) {
      return { type: 'oauth', token: oauthToken.accessToken };
    }

    // Fallback to API key
    try {
      const apiKey = this.vault.getDecrypted('anthropic', 'default', project);
      return { type: 'api-key', key: apiKey };
    } catch {
      // No OAuth, no API key
      throw new Error('No Anthropic credentials available. Set up OAuth with Claude CLI or add an API key to the vault.');
    }
  }

  /**
   * Get cache key for the client based on auth mode.
   */
  private getAuthCacheKey(auth: AuthMode): string {
    return auth.type === 'oauth' ? `oauth:${auth.token.slice(0, 16)}` : `key:${auth.key.slice(0, 16)}`;
  }

  /**
   * Get or create a cached Anthropic client for the given auth mode.
   */
  private getClient(auth: AuthMode): Anthropic {
    const cacheKey = this.getAuthCacheKey(auth);

    if (!this.clientCache.has(cacheKey)) {
      const config = auth.type === 'oauth'
        ? { token: auth.token }
        : { apiKey: auth.key };

      this.clientCache.set(cacheKey, new Anthropic(config));
    }
    return this.clientCache.get(cacheKey)!;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const auth = await this.getAuthMode(request.project);
    const client = this.getClient(auth);

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
    // Check OAuth first
    const oauthToken = this.vault.getClaudeOAuthTokenSync();
    if (oauthToken) {
      return true;
    }
    // Fall back to API key check
    return this.vault.has('anthropic');
  }
}
