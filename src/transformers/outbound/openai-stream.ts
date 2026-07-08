/**
 * Streaming outbound transformer for OpenAI-compatible providers.
 *
 * Handles streaming for OpenAI-compatible providers.
 * Parses OpenAI streaming chunk format into InternalLLMChunk.
 */

import type { InternalLLMRequest, ToolCall } from '../../core/internal-model.js';
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

      // Accumulate incremental `delta.tool_calls` fragments across chunks, keyed by
      // the OpenAI-assigned `index`. Same documented limitation as
      // outbound/anthropic-stream.ts: this bridge surfaces ONE complete ToolCall per
      // index, attached to the terminal chunk — not incremental argument fragments.
      const toolCallAccumulators = new Map<
        number,
        { id: string; name: string; argsFragments: string[] }
      >();

      for await (const rawChunk of stream) {
        const raw = rawChunk as Record<string, unknown>;
        const choices = raw['choices'] as Array<Record<string, unknown>> | undefined;
        const delta = choices?.[0]?.['delta'] as Record<string, unknown> | undefined;
        const toolCallDeltas = delta?.['tool_calls'] as Array<Record<string, unknown>> | undefined;

        if (Array.isArray(toolCallDeltas)) {
          for (const tcDelta of toolCallDeltas) {
            const index = typeof tcDelta['index'] === 'number' ? tcDelta['index'] : 0;
            const existing = toolCallAccumulators.get(index) ?? {
              id: '',
              name: '',
              argsFragments: [],
            };
            if (typeof tcDelta['id'] === 'string' && tcDelta['id']) {
              existing.id = tcDelta['id'];
            }
            const fn = tcDelta['function'] as Record<string, unknown> | undefined;
            if (typeof fn?.['name'] === 'string' && fn['name']) {
              existing.name = fn['name'];
            }
            if (typeof fn?.['arguments'] === 'string') {
              existing.argsFragments.push(fn['arguments']);
            }
            toolCallAccumulators.set(index, existing);
          }
        }

        const chunk = parseOpenAIChunk(rawChunk);

        if (chunk.done && toolCallAccumulators.size > 0) {
          const toolCalls: ToolCall[] = [...toolCallAccumulators.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, acc]) => ({
              id: acc.id,
              type: 'function' as const,
              function: { name: acc.name, arguments: acc.argsFragments.join('') || '{}' },
            }));
          chunk.toolCalls = toolCalls;
        }

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

/** Cerebras streaming transformer (OpenAI-compatible). */
export const cerebrasStreamTransformer = createOpenAIStreamTransformer('cerebras');

/** Z.AI streaming transformer (OpenAI-compatible). */
export const zaiStreamTransformer = createOpenAIStreamTransformer('zai');

/** NVIDIA NIM streaming transformer (OpenAI-compatible). */
export const nvidiaStreamTransformer = createOpenAIStreamTransformer('nvidia');

/** Mistral streaming transformer (OpenAI-compatible). */
export const mistralStreamTransformer = createOpenAIStreamTransformer('mistral');

/** SambaNova streaming transformer (OpenAI-compatible). */
export const sambanovaStreamTransformer = createOpenAIStreamTransformer('sambanova');

/** Hyperbolic streaming transformer (OpenAI-compatible). */
export const hyperbolicStreamTransformer = createOpenAIStreamTransformer('hyperbolic');
