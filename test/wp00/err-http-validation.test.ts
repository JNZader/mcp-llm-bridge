import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { Router } from '../../src/core/router.js';
import type { Vault } from '../../src/vault/vault.js';
import { TransformError } from '../../src/core/transformer.js';
import { safeError, toSafeHttpError } from '../../src/core/safe-error.js';
import { anthropicInbound } from '../../src/transformers/inbound/anthropic.js';
import { registerMessagesRoutes } from '../../src/server/routes/messages.js';

const CANARY = 'private-validation-canary';
const INVALID = toSafeHttpError(safeError('INVALID_REQUEST')).body.error;
const INTERNAL = toSafeHttpError(safeError('INTERNAL_ERROR')).body.error;
const valid = { max_tokens: 10, messages: [{ role: 'user', content: 'hello' }] };
const invalidRequests = [
  ['role', { messages: [{ role: CANARY, content: 'hello' }] }],
  ['content type', { messages: [{ role: 'user', content: [{ type: CANARY }] }] }],
  ['content block', { messages: [{ role: 'user', content: [CANARY] }] }],
  ['image source', { messages: [{ role: 'user', content: [{ type: 'image', source: { type: CANARY } }] }] }],
  ['tool definition', { tools: [CANARY] }],
  ['message shape', { messages: [CANARY] }],
  ['empty messages', { messages: [], private_metadata: CANARY }],
] as const;

function fixture(providerFailure?: () => never) {
  let calls = 0;
  let escaped = 0;
  const execute = async () => {
    calls++;
    if (providerFailure) providerFailure();
    return { content: 'answer', model: 'fixture-model', finishReason: 'stop' as const,
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } };
  };
  const router = { generateFromInternal: execute, resolveStreamingProviders: async () => {
    calls++;
    if (providerFailure) providerFailure();
    throw new Error('Unexpected streaming resolution in validation fixture');
  } } as unknown as Router;
  const app = new Hono();
  app.onError((_error, c) => { escaped++; return c.json({ unexpected_fallback: true }, 500); });
  registerMessagesRoutes(app, { router, vault: {} as Vault });
  return { app, calls: () => calls, escaped: () => escaped };
}

function post(app: Hono, body: unknown) {
  return app.request('/v1/messages', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function assertError(response: Response, status: number, type: string, message: string) {
  assert.equal(response.status, status);
  assert.doesNotMatch(response.headers.get('content-type') ?? '', /text\/event-stream/);
  const body = await response.json();
  assert.deepEqual(body, { type: 'error', error: { type, message } });
  assert.equal(JSON.stringify(body).includes(CANARY), false);
}

// Transformer replacement is confined to serial tests and always restored, including RED failures.
describe('Anthropic preparation error containment', { concurrency: false, timeout: 10_000 }, () => {
  for (const stream of [false, true]) {
    for (const [label, invalid] of invalidRequests) {
      it(`stream=${stream}: real ${label} validation is a private-free 400 before routing`, async () => {
        const f = fixture();
        await assertError(await post(f.app, { ...valid, ...invalid, stream }), 400, 'invalid_request_error', INVALID);
        assert.equal(f.calls(), 0);
        assert.equal(f.escaped(), 0);
      });
    }

    for (const kind of ['error', 'string', 'getter', 'coercion', 'revoked', 'transform-getter']) {
      it(`stream=${stream}: contains ${kind} preparation failure without message/coercion access`, async () => {
        let accesses = 0;
        let thrown: unknown = kind === 'string' ? CANARY : new Error(CANARY);
        if (kind === 'getter' || kind === 'transform-getter') {
          thrown = kind === 'transform-getter' ? new TransformError(CANARY, 'anthropic') : new Error(CANARY);
          Object.defineProperty(thrown, 'message', { get() { accesses++; throw new Error(CANARY); } });
        }
        if (kind === 'coercion') thrown = {
          get [Symbol.toPrimitive]() { accesses++; throw new Error(CANARY); },
        };
        if (kind === 'revoked') {
          const proxy = Proxy.revocable({}, {});
          proxy.revoke();
          thrown = proxy.proxy;
        }
        const original = anthropicInbound.transformRequest;
        const f = fixture();
        try {
          anthropicInbound.transformRequest = () => { throw thrown; };
          const genuine = kind === 'transform-getter';
          await assertError(await post(f.app, { ...valid, stream }), genuine ? 400 : 500,
            genuine ? 'invalid_request_error' : 'api_error', genuine ? INVALID : INTERNAL);
          assert.equal(accesses, 0);
          assert.equal(f.calls(), 0);
          assert.equal(f.escaped(), 0);
        } finally {
          anthropicInbound.transformRequest = original;
        }
        // A guarded instanceof may consult a proxy prototype; no zero-prototype-access claim.
        assert.equal(anthropicInbound.transformRequest, original);
      });
    }

    for (const typed of [false, true]) {
      it(`stream=${stream}: provider ${typed ? 'TransformError' : 'lookalike text'} stays operational 500`, async () => {
        const f = fixture(() => { throw typed ? new TransformError(CANARY, 'anthropic') : new Error(`TransformError: ${CANARY}`); });
        await assertError(await post(f.app, { ...valid, stream }), 500, 'api_error', INTERNAL);
        assert.equal(f.calls(), 1);
        assert.equal(f.escaped(), 0);
      });
    }
  }

  it('preserves successful real transformation and response shape', async () => {
    const f = fixture();
    const response = await post(f.app, valid);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.match(String(body.id), /^msg_/);
    assert.deepEqual(body, { id: body.id, type: 'message', role: 'assistant', model: 'fixture-model',
      content: [{ type: 'text', text: 'answer' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 2 } });
    assert.equal(f.calls(), 1);
  });

  for (const body of [null, [], CANARY]) {
    it(`preserves fixed non-object validation for ${JSON.stringify(body)}`, async () => {
      const f = fixture();
      await assertError(await post(f.app, body), 400, 'invalid_request_error', 'Request body must be a JSON object');
      assert.equal(f.calls(), 0);
    });
  }

  it('preserves fixed malformed-JSON validation', async () => {
    const f = fixture();
    const response = await f.app.request('/v1/messages', { method: 'POST', body: '{' });
    await assertError(response, 400, 'invalid_request_error', 'Invalid JSON body');
    assert.equal(f.calls(), 0);
  });
});
