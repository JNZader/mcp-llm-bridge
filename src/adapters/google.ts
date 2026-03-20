/**
 * Google (Gemini) API adapter — OpenAI-compatible API with credentials from Vault.
 *
 * Google exposes an OpenAI-compatible endpoint for Gemini models at
 * generativelanguage.googleapis.com. We reuse the `openai` SDK with
 * a custom base URL.
 */

import { BaseOpenAICompatibleAdapter } from './base-adapter.js';
import type { Vault } from '../vault/vault.js';

export class GoogleAdapter extends BaseOpenAICompatibleAdapter {
  readonly id = 'google';
  readonly name = 'Google';
  readonly baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
  readonly models = [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', maxTokens: 8192 },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', maxTokens: 8192 },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google', maxTokens: 8192 },
  ];
  readonly defaultModel = 'gemini-2.5-flash';

  constructor(vault: Vault) {
    super(vault);
  }
}
