import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { Router } from '../../src/core/router.js';
import type { Vault } from '../../src/vault/vault.js';
import type { InternalLLMChunk } from '../../src/transformers/streaming.js';
import { safeError, toSafeHttpError } from '../../src/core/safe-error.js';
import { registerExecutionRoutes } from '../../src/server/routes/execution.js';
import { registerMessagesRoutes } from '../../src/server/routes/messages.js';

const CANARY = 'private-stream-provider-canary';
const INTERNAL = toSafeHttpError(safeError('INTERNAL_ERROR')).body.error;
const protocols = ['openai', 'anthropic'] as const;
type Protocol = typeof protocols[number];
interface SSEEvent { event: string; data: unknown }
interface Captured { response: Response; raw: string }

function candidate(chunks: () => AsyncGenerator<InternalLLMChunk>, id: string) {
  let starts = 0;
  let closed = 0;
  const value = {
    provider: { id, name: id, type: 'api', models: [],
      generate: async () => { throw new Error('Unexpected provider call'); },
      isAvailable: async () => true },
    request: { messages: [], model: 'fixture-model' },
    streamTransformer: { name: id, async *transformStream() {
      starts++;
      try { yield* chunks(); } finally { closed++; }
    } },
    executionContract: { recordAttempt() {}, snapshot: () => ({}) },
    recordResult() {},
  };
  // The transformer supplies local chunks and never invokes the SDK callback.
  return { value, starts: () => starts, closed: () => closed };
}

function fixture(resolve: () => Promise<ReturnType<typeof candidate>['value'][]>, fail?: unknown) {
  let fallbackCalls = 0;
  const fallback = async () => { fallbackCalls++; throw fail; };
  const router = { resolveStreamingProviders: resolve,
    generate: fallback, generateFromInternal: fallback } as unknown as Router;
  const app = new Hono();
  app.onError((_error, c) => c.json({ unexpected_framework_error: true }, 500));
  const deps = { router, vault: {} as Vault };
  registerExecutionRoutes(app, deps);
  registerMessagesRoutes(app, deps);
  return { app, fallbackCalls: () => fallbackCalls };
}

async function capture(app: Hono, protocol: Protocol, controller = new AbortController()): Promise<Captured> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      reject(new Error('SSE fixture exceeded its 3 second deadline'));
    }, 3000);
  });
  const consume = async () => {
    const response = await app.request(protocol === 'openai' ? '/v1/chat/completions' : '/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ model: 'fixture-model', max_tokens: 10, stream: true,
        messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.ok(response.body);
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let raw = '';
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      raw += decoder.decode(part.value, { stream: true });
      assert.ok(raw.length < 64_000, 'Fixture response exceeded its byte budget');
    }
    raw += decoder.decode();
    return { response, raw };
  };
  try { return await Promise.race([consume(), deadline]); }
  finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}

function events(raw: string): SSEEvent[] {
  assert.ok(raw.endsWith('\n\n'), 'SSE must end at a complete event boundary');
  return raw.split('\n\n').filter(Boolean).map((block) => {
    const lines = block.split('\n');
    const payload = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim());
    assert.equal(payload.length, 1);
    return { event: lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? '',
      data: payload[0] === '[DONE]' ? '[DONE]' : JSON.parse(payload[0]!) };
  });
}

function assertFailure(result: Captured, protocol: Protocol, midstream: boolean) {
  assert.equal(result.raw.includes(CANARY), false);
  const anthropicError = { type: 'error', error: { type: 'api_error', message: INTERNAL } };
  if (protocol === 'anthropic' && !midstream) {
    assert.equal(result.response.status, 500);
    assert.doesNotMatch(result.response.headers.get('content-type') ?? '', /text\/event-stream/);
    assert.deepEqual(JSON.parse(result.raw), anthropicError);
    return;
  }
  assert.equal(result.response.status, 200);
  assert.match(result.response.headers.get('content-type') ?? '', /text\/event-stream/);
  const parsed = events(result.raw);
  if (protocol === 'openai') {
    const terminal = { error: { message: INTERNAL, type: 'server_error', code: null } };
    assert.deepEqual(parsed.slice(-2), [{ event: '', data: terminal }, { event: '', data: '[DONE]' }]);
    assert.equal(parsed.filter((entry) => entry.data === '[DONE]').length, 1);
    assert.equal(parsed.filter((entry) => JSON.stringify(entry.data) === JSON.stringify(terminal)).length, 1);
    assert.equal(parsed.length, midstream ? 3 : 2);
  } else {
    assert.deepEqual(parsed.map((entry) => entry.event), [
      'message_start', 'content_block_start', 'ping', 'content_block_delta', 'content_block_stop', 'error',
    ]);
    assert.deepEqual(parsed.at(-1)?.data, anthropicError);
    assert.equal(parsed.some((entry) => entry.event === 'message_stop'), false);
  }
  if (midstream) assert.ok(result.raw.includes('partial-public-answer'));
}

function failure(kind: string): unknown {
  if (kind === 'string') return CANARY;
  if (kind === 'hostile') return {
    get [Symbol.toPrimitive]() { throw new Error(CANARY); },
    get message() { throw new Error(CANARY); },
  };
  return new Error(CANARY);
}

async function* success(): AsyncGenerator<InternalLLMChunk> {
  yield { content: 'public-answer', done: false };
  // Natural EOF lets both protocol consumers exhaust and close this local iterator.
  yield { content: '', done: false, finishReason: 'stop', tokensIn: 1, tokensOut: 2 };
}

function assertSuccess(result: Captured, protocol: Protocol) {
  assert.equal(result.response.status, 200);
  assert.match(result.response.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.ok(result.raw.includes('public-answer'));
  assert.equal(result.raw.includes(CANARY), false);
  const parsed = events(result.raw);
  assert.equal(parsed.some((entry) => entry.event === 'error'), false);
  if (protocol === 'openai') {
    assert.equal(parsed.at(-1)?.data, '[DONE]');
    assert.equal(parsed.filter((entry) => entry.data === '[DONE]').length, 1);
    assert.equal(parsed.some((entry) => typeof entry.data === 'object' && entry.data !== null && 'error' in entry.data), false);
  } else {
    assert.deepEqual(parsed.slice(-2).map((entry) => entry.event), ['message_delta', 'message_stop']);
    assert.equal(parsed.filter((entry) => entry.event === 'message_stop').length, 1);
  }
}

describe('Public streaming failure containment', { timeout: 30_000 }, () => {
  for (const protocol of protocols) {
    for (const phase of ['resolve', 'fallback', 'open', 'midstream'] as const) {
      for (const kind of ['error', 'string', 'hostile']) {
        it(`${protocol} contains ${kind} failure at ${phase} and closes exactly once`, { timeout: 5000 }, async () => {
          const thrown = failure(kind);
          const first = candidate(async function* () {
            if (phase === 'midstream') yield { content: 'partial-public-answer', done: false };
            throw thrown;
          }, `fixture-${protocol}-${phase}-${kind}`);
          const second = candidate(success, 'unused-after-content');
          const { app, fallbackCalls } = fixture(async () => {
            if (phase === 'resolve') throw thrown;
            if (phase === 'fallback') return [];
            return phase === 'midstream' ? [first.value, second.value] : [first.value];
          }, thrown);
          // OpenAI's internal abort/normalization code may inspect unknowns upstream.
          // This assertion covers HTTP output and completion, not global zero-access behavior.
          assertFailure(await capture(app, protocol), protocol, phase === 'midstream');
          assert.equal(second.starts(), 0, 'No retry after public content');
          assert.equal(fallbackCalls(), phase === 'fallback' ? 1 : 0);
          assert.equal(first.closed(), phase === 'open' || phase === 'midstream' ? 1 : 0);
        });
      }
    }

    it(`${protocol} preserves successful completion`, async () => {
      const stream = candidate(success, `success-${protocol}`);
      const { app } = fixture(async () => [stream.value]);
      assertSuccess(await capture(app, protocol), protocol);
      assert.equal(stream.closed(), 1);
    });

    it(`${protocol} retries before content without publishing the failed attempt`, async () => {
      const first = candidate(async function* () { throw new Error(CANARY); }, `retry-first-${protocol}`);
      const second = candidate(success, `retry-second-${protocol}`);
      const { app } = fixture(async () => [first.value, second.value]);
      assertSuccess(await capture(app, protocol), protocol);
      assert.equal(first.starts(), 1);
      assert.equal(second.starts(), 1);
      assert.equal(first.closed(), 1);
      assert.equal(second.closed(), 1);
    });
  }

  it('OpenAI preserves pre-aborted client completion without provider calls or terminal events', async () => {
    let resolutions = 0;
    const controller = new AbortController();
    controller.abort();
    const { app } = fixture(async () => { resolutions++; return []; });
    const result = await capture(app, 'openai', controller);
    assert.equal(resolutions, 0);
    assert.equal(result.raw, '');
  });
});
