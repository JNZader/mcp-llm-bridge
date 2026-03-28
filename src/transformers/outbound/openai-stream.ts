/**
 * Streaming outbound transformer for OpenAI-compatible providers.
 *
 * Handles streaming for: OpenAI, Groq, OpenRouter, Google (OpenAI-compat).
 * Parses OpenAI streaming chunk format into InternalLLMChunk.
 */

import type { InternalLLMRequest } from '../../core/internal-model.js';
import type { InternalLLMChunk, StreamingOutboundTransformer } from '../streaming.js';
import { openaiOutbound } from './openai.js';

/**
 * Parse an OpenAI streaming chunk (from the SDK's stream iterator) into
 * an InternalLLMChunk.
 *
 * The OpenAI SDK yields objects shaped like:
 * {
 *   id: "chatcmpl-...",
 *   object: "chat.completion.chunk",
 *   choices: [{ index: 0, delta: { content: "..." }, finish_reason: null | "stop" }],
 *   usage?: { prompt_tokens, completion_tokens, total_tokens }
 * }
 */
function parseOpenAIChunk(raw: unknown): InternalLLMChunk {
  const chunk = raw as Record<string, unknown>;
  const choices = chunk['choices'] as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0];
  const delta = choice?.['delta'] as Record<string, unknown> | undefined;
  const finishReason = choice?.['finish_reason'] as string | null | undefined;

  const content = typeof delta?.['content'] === 'string' ? delta['content'] : '';
  const done = finishReason !== null && finishReason !== undefined;

  const result: InternalLLMChunk = { content, done };

  if (typeof chunk['model'] === 'string') {
    result.model = chunk['model'];
  }

  if (done && finishReason) {
    result.finishReason = mapFinishReason(finishReason);
  }

  // Usage is available on the final chunk when `stream_options: { include_usage: true }`
  const usage = chunk['usage'] as Record<string, unknown> | undefined;
  if (usage) {
    if (typeof usage['prompt_tokens'] === 'number') result.tokensIn = usage['prompt_tokens'];
    if (typeof usage['completion_tokens'] === 'number') result.tokensOut = usage['completion_tokens'];
  }

  return result;
}

function mapFinishReason(reason: string): InternalLLMChunk['finishReason'] {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'tool_calls': return 'tool_calls';
    case 'content_filter': return 'content_filter';
    default: return 'stop';
  }
}

/**
 * Create a streaming outbound transformer for an OpenAI-compatible provider.
 */
function createOpenAIStreamTransformer(providerName: string): StreamingOutboundTransformer {
  return {
    name: providerName,

    async *transformStream(
      internal: InternalLLMRequest,
      providerCall: (request: unknown) => AsyncIterable<unknown>,
    ): AsyncGenerator<InternalLLMChunk> {
      // Build the OpenAI-format request body and add streaming flags
      const requestBody = openaiOutbound.transformRequest(internal) as Record<string, unknown>;
      requestBody['stream'] = true;
      requestBody['stream_options'] = { include_usage: true };

      const stream = providerCall(requestBody);

      for await (const rawChunk of stream) {
        const chunk = parseOpenAIChunk(rawChunk);
        yield chunk;
      }
    },
  };
}

/** OpenAI streaming transformer. */
export const openaiStreamTransformer = createOpenAIStreamTransformer('openai');

/** Groq streaming transformer (OpenAI-compatible). */
export const groqStreamTransformer = createOpenAIStreamTransformer('groq');

/** OpenRouter streaming transformer (OpenAI-compatible). */
export const openrouterStreamTransformer = createOpenAIStreamTransformer('openrouter');

/** Google streaming transformer (OpenAI-compatible). */
export const googleStreamTransformer = createOpenAIStreamTransformer('google');
