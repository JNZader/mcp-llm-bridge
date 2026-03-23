/**
 * Streaming outbound transformer for Anthropic Messages API.
 *
 * Parses Anthropic streaming events into InternalLLMChunk.
 *
 * Anthropic streaming events:
 * - message_start: { message: { model, usage: { input_tokens } } }
 * - content_block_start: { content_block: { type: "text" } }
 * - content_block_delta: { delta: { type: "text_delta", text: "..." } }
 * - content_block_stop: {}
 * - message_delta: { delta: { stop_reason: "end_turn" }, usage: { output_tokens } }
 * - message_stop: {}
 */

import type { InternalLLMRequest } from '../../core/internal-model.js';
import type { InternalLLMChunk, StreamingOutboundTransformer } from '../streaming.js';
import { anthropicOutbound } from './anthropic.js';

function mapStopReason(reason: string | undefined | null): InternalLLMChunk['finishReason'] {
  switch (reason) {
    case 'end_turn': return 'stop';
    case 'stop_sequence': return 'stop';
    case 'max_tokens': return 'length';
    case 'tool_use': return 'tool_calls';
    default: return 'stop';
  }
}

/**
 * Anthropic streaming outbound transformer.
 *
 * The Anthropic SDK's streaming returns events with a `type` field.
 * We normalize these into InternalLLMChunk.
 */
export const anthropicStreamTransformer: StreamingOutboundTransformer = {
  name: 'anthropic',

  async *transformStream(
    internal: InternalLLMRequest,
    providerCall: (request: unknown) => AsyncIterable<unknown>,
  ): AsyncGenerator<InternalLLMChunk> {
    // Build the Anthropic-format request body and add streaming flag
    const requestBody = anthropicOutbound.transformRequest(internal) as Record<string, unknown>;
    requestBody['stream'] = true;

    const stream = providerCall(requestBody);

    let model: string | undefined;
    let tokensIn: number | undefined;
    let tokensOut: number | undefined;

    for await (const event of stream) {
      const evt = event as Record<string, unknown>;
      const type = evt['type'] as string;

      switch (type) {
        case 'message_start': {
          const message = evt['message'] as Record<string, unknown> | undefined;
          if (message) {
            model = typeof message['model'] === 'string' ? message['model'] : undefined;
            const usage = message['usage'] as Record<string, unknown> | undefined;
            if (typeof usage?.['input_tokens'] === 'number') {
              tokensIn = usage['input_tokens'];
            }
          }
          break;
        }

        case 'content_block_delta': {
          const delta = evt['delta'] as Record<string, unknown> | undefined;
          if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
            yield {
              content: delta['text'],
              done: false,
              model,
            };
          }
          break;
        }

        case 'message_delta': {
          const delta = evt['delta'] as Record<string, unknown> | undefined;
          const usage = evt['usage'] as Record<string, unknown> | undefined;
          if (typeof usage?.['output_tokens'] === 'number') {
            tokensOut = usage['output_tokens'];
          }

          const stopReason = delta?.['stop_reason'] as string | undefined;
          yield {
            content: '',
            done: true,
            model,
            finishReason: mapStopReason(stopReason),
            tokensIn,
            tokensOut,
          };
          break;
        }

        // Other event types (content_block_start, content_block_stop, message_stop)
        // don't carry content we need to forward.
        default:
          break;
      }
    }
  },
};
