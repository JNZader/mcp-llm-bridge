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

import type { InternalLLMRequest, ToolCall } from '../../core/internal-model.js';
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

    // Track in-flight `tool_use` content blocks by their Anthropic content_block
    // index so incremental `input_json_delta` fragments can be joined into one
    // complete JSON string per tool call.
    //
    // IMPORTANT LIMITATION: the real Anthropic API streams tool call arguments
    // incrementally (one or more `input_json_delta` events per block), but this
    // bridge's `InternalLLMChunk` abstraction only carries a single, complete
    // `ToolCall` payload — attached to the terminal (`done: true`) chunk once the
    // block closes. Incremental tool-argument fragments are buffered here and
    // never forwarded individually. This is a deliberate, documented scope
    // limitation (see 3b-2 report), not a bug.
    const pendingToolBlocks = new Map<
      number,
      { id: string; name: string; jsonFragments: string[] }
    >();
    const completedToolCalls: ToolCall[] = [];

    for await (const event of stream) {
      const evt = event as Record<string, unknown>;
      const type = evt['type'] as string;
      const index = typeof evt['index'] === 'number' ? evt['index'] : undefined;

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

        case 'content_block_start': {
          const block = evt['content_block'] as Record<string, unknown> | undefined;
          if (index !== undefined && block?.['type'] === 'tool_use') {
            pendingToolBlocks.set(index, {
              id: typeof block['id'] === 'string' ? block['id'] : '',
              name: typeof block['name'] === 'string' ? block['name'] : '',
              jsonFragments: [],
            });
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
          } else if (
            delta?.['type'] === 'input_json_delta' &&
            typeof delta['partial_json'] === 'string' &&
            index !== undefined
          ) {
            pendingToolBlocks.get(index)?.jsonFragments.push(delta['partial_json']);
          }
          break;
        }

        case 'content_block_stop': {
          if (index !== undefined && pendingToolBlocks.has(index)) {
            const pending = pendingToolBlocks.get(index);
            pendingToolBlocks.delete(index);
            if (pending) {
              completedToolCalls.push({
                id: pending.id,
                type: 'function',
                function: {
                  name: pending.name,
                  arguments: pending.jsonFragments.join('') || '{}',
                },
              });
            }
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
            ...(completedToolCalls.length > 0 ? { toolCalls: completedToolCalls } : {}),
          };
          break;
        }

        // Other event types (message_stop) don't carry content we need to forward.
        default:
          break;
      }
    }
  },
};
