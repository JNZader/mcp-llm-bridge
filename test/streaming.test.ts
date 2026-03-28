/**
 * Streaming tests — SSE format, chunk transformation, cost accumulation,
 * token accumulator, and backward compatibility.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  serializeSSEChunk,
  SSE_DONE,
  StreamTokenAccumulator,
} from '../src/transformers/streaming.js';
import type { InternalLLMChunk } from '../src/transformers/streaming.js';
import { StreamRecorder, CostTracker } from '../src/core/cost-tracker.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Helpers ─────────────────────────────────────────────────

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'streaming-test-'));
  return join(dir, 'test.db');
}

// ── SSE Serialization ───────────────────────────────────────

describe('serializeSSEChunk', () => {
  it('serializes a content chunk in OpenAI SSE format', () => {
    const chunk: InternalLLMChunk = {
      content: 'Hello',
      done: false,
      model: 'gpt-4o',
    };

    const result = serializeSSEChunk(chunk, 'chatcmpl-123', 'gpt-4o');

    assert.ok(result.startsWith('data: '));
    assert.ok(result.endsWith('\n\n'));

    const json = JSON.parse(result.slice(6, -2));
    assert.equal(json.id, 'chatcmpl-123');
    assert.equal(json.object, 'chat.completion.chunk');
    assert.equal(json.model, 'gpt-4o');
    assert.equal(json.choices[0].delta.content, 'Hello');
    assert.equal(json.choices[0].finish_reason, null);
  });

  it('serializes a done chunk with finish_reason', () => {
    const chunk: InternalLLMChunk = {
      content: '',
      done: true,
      model: 'gpt-4o',
      finishReason: 'stop',
    };

    const result = serializeSSEChunk(chunk, 'chatcmpl-123', 'gpt-4o');
    const json = JSON.parse(result.slice(6, -2));

    assert.equal(json.choices[0].finish_reason, 'stop');
    assert.deepEqual(json.choices[0].delta, {});
  });

  it('includes usage on final chunk when tokens provided', () => {
    const chunk: InternalLLMChunk = {
      content: '',
      done: true,
      model: 'gpt-4o',
      finishReason: 'stop',
      tokensIn: 10,
      tokensOut: 25,
    };

    const result = serializeSSEChunk(chunk, 'chatcmpl-123', 'gpt-4o');
    const json = JSON.parse(result.slice(6, -2));

    assert.equal(json.usage.prompt_tokens, 10);
    assert.equal(json.usage.completion_tokens, 25);
    assert.equal(json.usage.total_tokens, 35);
  });

  it('does not include usage on non-final chunks', () => {
    const chunk: InternalLLMChunk = {
      content: 'text',
      done: false,
    };

    const result = serializeSSEChunk(chunk, 'chatcmpl-123', 'gpt-4o');
    const json = JSON.parse(result.slice(6, -2));

    assert.equal(json.usage, undefined);
  });

  it('uses provided model over chunk model when chunk.model is empty', () => {
    const chunk: InternalLLMChunk = {
      content: 'Hi',
      done: false,
    };

    const result = serializeSSEChunk(chunk, 'chatcmpl-123', 'fallback-model');
    const json = JSON.parse(result.slice(6, -2));

    assert.equal(json.model, 'fallback-model');
  });
});

describe('SSE_DONE', () => {
  it('is the correct terminator format', () => {
    assert.equal(SSE_DONE, 'data: [DONE]\n\n');
  });
});

// ── StreamTokenAccumulator ──────────────────────────────────

describe('StreamTokenAccumulator', () => {
  it('accumulates content from chunks', () => {
    const acc = new StreamTokenAccumulator();

    acc.addChunk({ content: 'Hello', done: false });
    acc.addChunk({ content: ' world', done: false });
    acc.addChunk({ content: '!', done: true, finishReason: 'stop' });

    assert.equal(acc.content, 'Hello world!');
    assert.equal(acc.finishReason, 'stop');
  });

  it('captures model and provider from chunks', () => {
    const acc = new StreamTokenAccumulator();

    acc.addChunk({ content: 'Hi', done: false, model: 'gpt-4o', provider: 'openai' });
    acc.addChunk({ content: '!', done: true });

    assert.equal(acc.model, 'gpt-4o');
    assert.equal(acc.provider, 'openai');
  });

  it('captures token counts from final chunk', () => {
    const acc = new StreamTokenAccumulator();

    acc.addChunk({ content: 'Hello', done: false });
    acc.addChunk({ content: '', done: true, tokensIn: 10, tokensOut: 25 });

    assert.equal(acc.tokensIn, 10);
    assert.equal(acc.tokensOut, 25);
  });

  it('estimates output tokens from character count when not reported', () => {
    const acc = new StreamTokenAccumulator();

    // 100 chars → ~25 tokens at 4 chars/token
    acc.addChunk({ content: 'a'.repeat(100), done: false });
    acc.addChunk({ content: '', done: true });

    assert.equal(acc.estimatedTokensOut, 25);
    assert.equal(acc.tokensOut, 0); // not reported
  });

  it('builds a partial Usage object', () => {
    const acc = new StreamTokenAccumulator();

    acc.addChunk({ content: '', done: true, tokensIn: 50, tokensOut: 100 });

    const usage = acc.toUsage();
    assert.equal(usage.inputTokens, 50);
    assert.equal(usage.outputTokens, 100);
    assert.equal(usage.totalTokens, 150);
  });

  it('uses estimated tokens in Usage when not reported', () => {
    const acc = new StreamTokenAccumulator();

    acc.addChunk({ content: 'a'.repeat(40), done: false }); // 10 estimated tokens
    acc.addChunk({ content: '', done: true, tokensIn: 5 });

    const usage = acc.toUsage();
    assert.equal(usage.inputTokens, 5);
    assert.equal(usage.outputTokens, 10); // estimated
    assert.equal(usage.totalTokens, 15);
  });
});

// ── StreamRecorder (Cost Accumulation) ──────────────────────

describe('StreamRecorder', () => {
  let tracker: CostTracker;
  let dbPath: string;

  function setup(): void {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });
  }

  function teardown(): void {
    try { tracker.destroy(); } catch { /* ok */ }
    try { rmSync(dbPath, { force: true }); } catch { /* ok */ }
    try { rmSync(dbPath + '-wal', { force: true }); } catch { /* ok */ }
    try { rmSync(dbPath + '-shm', { force: true }); } catch { /* ok */ }
  }

  it('records stream usage after finish()', () => {
    setup();
    try {
      const recorder = tracker.recordStream('openai', 'gpt-4o', 'test-project');

      recorder.addChunk({ tokensIn: 10 }, 0);
      recorder.addChunk({ tokensOut: 50 }, 200);
      recorder.finish();

      assert.equal(recorder.finished, true);
      assert.equal(recorder.tokensIn, 10);
      assert.equal(recorder.tokensOut, 50);
      assert.equal(tracker.bufferSize, 1);

      // Flush and verify
      tracker.flush();
      const records = tracker.query({ provider: 'openai' });
      assert.equal(records.length, 1);
      assert.equal(records[0]?.tokensIn, 10);
      assert.equal(records[0]?.tokensOut, 50);
      assert.equal(records[0]?.model, 'gpt-4o');
      assert.equal(records[0]?.project, 'test-project');
      assert.equal(records[0]?.success, true);
    } finally {
      teardown();
    }
  });

  it('estimates output tokens from character count when not reported', () => {
    setup();
    try {
      const recorder = tracker.recordStream('anthropic', 'claude-3');

      // 400 chars → ~100 tokens
      recorder.addChunk({}, 200);
      recorder.addChunk({}, 200);
      recorder.finish();

      tracker.flush();
      const records = tracker.query({ provider: 'anthropic' });
      assert.equal(records.length, 1);
      assert.equal(records[0]?.tokensOut, 100); // 400/4
    } finally {
      teardown();
    }
  });

  it('records error message on failed stream', () => {
    setup();
    try {
      const recorder = tracker.recordStream('openai', 'gpt-4o');

      recorder.addChunk({}, 50);
      recorder.finish('Connection reset');

      tracker.flush();
      const records = tracker.query({ provider: 'openai' });
      assert.equal(records.length, 1);
      assert.equal(records[0]?.success, false);
      assert.equal(records[0]?.errorMessage, 'Connection reset');
    } finally {
      teardown();
    }
  });

  it('does not double-record when finish() called twice', () => {
    setup();
    try {
      const recorder = tracker.recordStream('openai', 'gpt-4o');

      recorder.finish();
      recorder.finish(); // should be no-op

      assert.equal(tracker.bufferSize, 1);
    } finally {
      teardown();
    }
  });

  it('ignores addChunk after finish', () => {
    setup();
    try {
      const recorder = tracker.recordStream('openai', 'gpt-4o');

      recorder.finish();
      recorder.addChunk({ tokensIn: 999 }, 999);

      assert.equal(recorder.tokensIn, 0); // not updated after finish
    } finally {
      teardown();
    }
  });
});

// ── OpenAI Stream Chunk Parsing ─────────────────────────────

describe('OpenAI stream chunk parsing', () => {
  // Import the streaming transformer to test chunk parsing indirectly
  // via the transformStream generator

  it('transforms a sequence of OpenAI-format chunks', async () => {
    const { openaiStreamTransformer } = await import('../src/transformers/outbound/openai-stream.js');

    const request = {
      messages: [{ role: 'user' as const, content: 'Hello' }],
      model: 'gpt-4o',
    };

    // Mock provider call that yields OpenAI-format chunks
    async function* mockProviderCall(_request: unknown): AsyncIterable<unknown> {
      yield {
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
      };
      yield {
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { content: ' world' }, finish_reason: null }],
      };
      yield {
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        model: 'gpt-4o',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      };
    }

    const chunks: InternalLLMChunk[] = [];
    for await (const chunk of openaiStreamTransformer.transformStream(request, mockProviderCall)) {
      chunks.push(chunk);
    }

    assert.equal(chunks.length, 3);
    assert.equal(chunks[0]?.content, 'Hello');
    assert.equal(chunks[0]?.done, false);
    assert.equal(chunks[1]?.content, ' world');
    assert.equal(chunks[1]?.done, false);
    assert.equal(chunks[2]?.content, '');
    assert.equal(chunks[2]?.done, true);
    assert.equal(chunks[2]?.finishReason, 'stop');
    assert.equal(chunks[2]?.tokensIn, 5);
    assert.equal(chunks[2]?.tokensOut, 2);
  });
});

// ── Anthropic Stream Chunk Parsing ──────────────────────────

describe('Anthropic stream chunk parsing', () => {
  it('transforms a sequence of Anthropic streaming events', async () => {
    const { anthropicStreamTransformer } = await import('../src/transformers/outbound/anthropic-stream.js');

    const request = {
      messages: [{ role: 'user' as const, content: 'Hello' }],
      model: 'claude-sonnet-4-20250514',
      maxTokens: 1024,
    };

    // Mock Anthropic streaming events
    async function* mockProviderCall(_request: unknown): AsyncIterable<unknown> {
      yield {
        type: 'message_start',
        message: {
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 10 },
        },
      };
      yield {
        type: 'content_block_start',
        content_block: { type: 'text' },
      };
      yield {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello' },
      };
      yield {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: ' world' },
      };
      yield {
        type: 'content_block_stop',
      };
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 2 },
      };
      yield {
        type: 'message_stop',
      };
    }

    const chunks: InternalLLMChunk[] = [];
    for await (const chunk of anthropicStreamTransformer.transformStream(request, mockProviderCall)) {
      chunks.push(chunk);
    }

    // Should get 3 chunks: 2 content + 1 done
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0]?.content, 'Hello');
    assert.equal(chunks[0]?.done, false);
    assert.equal(chunks[0]?.model, 'claude-sonnet-4-20250514');
    assert.equal(chunks[1]?.content, ' world');
    assert.equal(chunks[1]?.done, false);
    assert.equal(chunks[2]?.content, '');
    assert.equal(chunks[2]?.done, true);
    assert.equal(chunks[2]?.finishReason, 'stop');
    assert.equal(chunks[2]?.tokensIn, 10);
    assert.equal(chunks[2]?.tokensOut, 2);
  });
});

// ── TransformerRegistry Streaming ───────────────────────────

describe('TransformerRegistry streaming', () => {
  it('registers and retrieves streaming outbound transformers', async () => {
    const { TransformerRegistry } = await import('../src/core/transformer.js');

    const reg = new TransformerRegistry();

    const mockTransformer = {
      name: 'test-provider',
      async *transformStream() {
        yield { content: 'test', done: true };
      },
    } as unknown as import('../src/transformers/streaming.js').StreamingOutboundTransformer;

    reg.registerStreamOutbound('test-provider', mockTransformer);

    const found = reg.getStreamOutbound('test-provider');
    assert.ok(found);
    assert.equal(found.name, 'test-provider');

    const notFound = reg.getStreamOutbound('nonexistent');
    assert.equal(notFound, null);
  });
});

// ── Backward Compatibility ──────────────────────────────────

describe('Backward compatibility', () => {
  it('non-streaming requests still work (stream:false)', async () => {
    // This is tested implicitly by existing /v1/chat/completions tests
    // but we verify the schema validation accepts stream:false
    const { validateChatCompletions } = await import('../src/core/schemas.js');

    const result = validateChatCompletions({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: false,
    });

    assert.equal(result.stream, false);
  });

  it('stream:true is accepted by validation', async () => {
    const { validateChatCompletions } = await import('../src/core/schemas.js');

    const result = validateChatCompletions({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    });

    assert.equal(result.stream, true);
  });
});
