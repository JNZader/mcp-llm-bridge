/**
 * Outbound transformer for Google Gemini format.
 *
 * Google exposes an OpenAI-compatible endpoint, so this transformer
 * produces the same format as the OpenAI outbound transformer.
 * The response format is also OpenAI-compatible.
 *
 * We keep a separate transformer for Google so the registry can
 * look up 'google' by name, but the implementation delegates to
 * the same OpenAI-compatible format.
 */

import type { OutboundTransformer } from '../../core/transformer.js';
import { openaiOutbound } from './openai.js';
import type { InternalLLMRequest, InternalLLMResponse } from '../../core/internal-model.js';

export const googleOutbound: OutboundTransformer = {
  name: 'google',

  transformRequest(internal: InternalLLMRequest): unknown {
    return openaiOutbound.transformRequest(internal);
  },

  transformResponse(providerResponse: unknown): InternalLLMResponse {
    return openaiOutbound.transformResponse(providerResponse);
  },
};
