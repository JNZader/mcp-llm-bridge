/**
 * Streaming types, transformer interfaces, and SSE serialization utilities.
 *
 * Defines the chunk format for streaming responses, the streaming outbound
 * transformer interface, and helpers for converting chunks to OpenAI-compatible
 * Server-Sent Events format.
 */

import type { InternalLLMRequest, Usage } from '../core/internal-model.js';

// ── Streaming Chunk ─────────────────────────────────────────

/**
 * A single chunk in a streaming LLM response.
 *
 * - `content`: text delta for this chunk (empty string if no content yet).
 * - `done`: true on the final chunk — signals end of stream.
 * - `model` / `provider`: populated on the first or final chunk.
 * - Token counts are typically available only on the final chunk.
 */
export interface InternalLLMChunk {
  content: string;
  done: boolean;
  model?: string;
  provider?: string;
  tokensIn?: number;
  tokensOut?: number;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
}

// ── Streaming Outbound Transformer ──────────────────────────

/**
 * Outbound transformer that returns an AsyncGenerator yielding
 * InternalLLMChunk objects.
 *
 * Each provider's streaming transformer converts InternalLLMRequest
 * into the provider's native streaming call and yields normalized chunks.
 */
export interface StreamingOutboundTransformer {
  /** Provider name this transformer targets. */
  readonly name: string;

  /**
   * Start a streaming request and yield chunks as they arrive.
   *
   * @param internal - The canonical request.
   * @param providerCall - A callback that the transformer uses to make the
   *   actual streaming SDK call. This decouples the transformer from
   *   credential management.
   */
  transformStream(
    internal: InternalLLMRequest,
    providerCall: (request: unknown) => AsyncIterable<unknown>,
  ): AsyncGenerator<InternalLLMChunk>;
}

// ── SSE Serialization ───────────────────────────────────────

/**
 * Serialize a streaming chunk as an OpenAI-compatible SSE `data:` line.
 *
 * Format: `data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":"..."}}]}\n\n`
 *
 * @param chunk - The internal streaming chunk.
 * @param chatId - The unique chat completion ID for this stream.
 * @param model - The model name to include in the SSE event.
 * @returns The SSE-formatted string (including trailing `\n\n`).
 */
export function serializeSSEChunk(
  chunk: InternalLLMChunk,
  chatId: string,
  model: string,
): string {
  const choice: Record<string, unknown> = {
    index: 0,
    delta: chunk.content ? { content: chunk.content } : {},
    finish_reason: chunk.done ? (mapFinishReason(chunk.finishReason) ?? 'stop') : null,
  };

  const event: Record<string, unknown> = {
    id: chatId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [choice],
  };

  // Include usage on the final chunk if available
  if (chunk.done && (chunk.tokensIn !== undefined || chunk.tokensOut !== undefined)) {
    event['usage'] = {
      prompt_tokens: chunk.tokensIn ?? 0,
      completion_tokens: chunk.tokensOut ?? 0,
      total_tokens: (chunk.tokensIn ?? 0) + (chunk.tokensOut ?? 0),
    };
  }

  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * The SSE terminator event that signals end of stream.
 */
export const SSE_DONE = 'data: [DONE]\n\n';

// ── Helpers ─────────────────────────────────────────────────

function mapFinishReason(reason: string | undefined): string | null {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'tool_calls': return 'tool_calls';
    case 'content_filter': return 'content_filter';
    case 'error': return 'stop';
    default: return null;
  }
}

// ── Token Accumulator ───────────────────────────────────────

/**
 * Accumulates content and token counts from streaming chunks.
 * Used to build the final usage record after a stream completes.
 */
export class StreamTokenAccumulator {
  private _content = '';
  private _tokensIn = 0;
  private _tokensOut = 0;
  private _model = '';
  private _provider = '';
  private _finishReason: InternalLLMChunk['finishReason'];

  /** Add a chunk's data to the accumulator. */
  addChunk(chunk: InternalLLMChunk): void {
    this._content += chunk.content;

    if (chunk.model) this._model = chunk.model;
    if (chunk.provider) this._provider = chunk.provider;
    if (chunk.finishReason) this._finishReason = chunk.finishReason;

    // Token counts are typically on the final chunk
    if (chunk.tokensIn !== undefined) this._tokensIn = chunk.tokensIn;
    if (chunk.tokensOut !== undefined) this._tokensOut = chunk.tokensOut;
  }

  /** Estimate output tokens from accumulated content if not reported. */
  get estimatedTokensOut(): number {
    if (this._tokensOut > 0) return this._tokensOut;
    // Rough estimate: ~4 chars per token (common for English text)
    return Math.ceil(this._content.length / 4);
  }

  get tokensIn(): number { return this._tokensIn; }
  get tokensOut(): number { return this._tokensOut; }
  get content(): string { return this._content; }
  get model(): string { return this._model; }
  get provider(): string { return this._provider; }
  get finishReason(): InternalLLMChunk['finishReason'] { return this._finishReason; }

  /** Build a partial Usage object from accumulated data. */
  toUsage(): Partial<Usage> {
    return {
      inputTokens: this._tokensIn,
      outputTokens: this._tokensOut > 0 ? this._tokensOut : this.estimatedTokensOut,
      totalTokens: this._tokensIn + (this._tokensOut > 0 ? this._tokensOut : this.estimatedTokensOut),
    };
  }
}
