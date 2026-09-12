import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { Router } from '../../src/core/router.js';
import type { Vault } from '../../src/vault/vault.js';
import { registerExecutionRoutes } from '../../src/server/routes/execution.js';
import { registerMessagesRoutes } from '../../src/server/routes/messages.js';
import { CHAT_COMPLETIONS_USER_MESSAGE_REQUIRED } from '../../src/server/http-helpers/chat-request.js';

const CANARY = 'private-provider-failure-canary';
const INTERNAL = 'An unexpected internal error occurred.';
const INVALID = 'The request is invalid.';
const generateResult = { text: 'answer', provider: 'fixture', model: 'model',
  resolvedProvider: 'fixture', resolvedModel: 'model', fallbackUsed: false, tokensUsed: 3 };
const requests = [
  { path: '/v1/generate', body: { prompt: 'hello', model: 'model' }, error: { error: INTERNAL } },
  { path: '/v1/chat/completions', body: { model: 'model', messages: [{ role: 'user', content: 'hello' }] },
    error: { error: { message: INTERNAL, type: 'server_error', param: null, code: null } } },
  { path: '/v1/messages', body: { model: 'model', max_tokens: 10, messages: [{ role: 'user', content: 'hello' }] },
    error: { type: 'error', error: { type: 'api_error', message: INTERNAL } } },
] as const;

function fixture(fail?: () => never) {
  const calls: unknown[] = [];
  const router: Pick<Router, 'generate' | 'generateFromInternal'> = {
    generate: async (input) => { calls.push(input); if (fail) fail(); return generateResult; },
    generateFromInternal: async (input) => {
      calls.push(input); if (fail) fail();
      return { content: 'answer', model: 'model', finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        metadata: { provider: 'fixture', resolvedProvider: 'fixture', resolvedModel: 'model' } };
    },
  };
  const app = new Hono();
  let escaped = 0;
  app.onError((_error, c) => { escaped++; return c.json({ unexpected_fallback: true }, 500); });
  // Only non-streaming capabilities are injected; services and route handlers remain real.
  const deps = { router: router as Router, vault: {} as Vault };
  registerExecutionRoutes(app, deps);
  registerMessagesRoutes(app, deps);
  return { app, calls, escaped: () => escaped };
}

function post(app: Hono, path: string, body: unknown) {
  return app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('Non-streaming API failure containment', () => {
  for (const route of requests) {
    for (const kind of ['error', 'string', 'getter', 'coercion'] as const) {
      it(`${route.path} returns its exact 500 envelope for ${kind} without exception inspection`, async () => {
        let accesses = 0;
        let failure: unknown = kind === 'string' ? CANARY : new Error(CANARY);
        if (kind === 'getter') Object.defineProperty(failure, 'message', { get() { accesses++; return CANARY; } });
        if (kind === 'coercion') failure = { get [Symbol.toPrimitive]() { accesses++; return () => { accesses++; return CANARY; }; } };
        // With no request logger, these non-streaming services rethrow without reading the failure.
        const { app, calls, escaped } = fixture(() => { throw failure; });
        const response = await post(app, route.path, route.body);
        assert.equal(calls.length, 1);
        assert.equal(escaped(), 0);
        assert.equal(accesses, 0);
        assert.equal(response.status, 500);
        const body = await response.json();
        assert.deepEqual(body, route.error);
        assert.equal(JSON.stringify(body).includes(CANARY), false);
      });
    }

    it(`${route.path} preserves its successful protocol response`, async () => {
      const { app, calls } = fixture();
      const response = await post(app, route.path, route.body);
      assert.equal(response.status, 200);
      assert.equal(calls.length, 1);
      const body = await response.json() as Record<string, unknown>;
      if (route.path === '/v1/generate') {
        assert.deepEqual(body, { ...generateResult, stop_reason: 'stop', finish_reason: 'stop' });
      } else if (route.path === '/v1/chat/completions') {
        assert.match(String(body.id), /^chatcmpl-/);
        assert.equal(typeof body.created, 'number');
        assert.deepEqual(body, { id: body.id, created: body.created, model: 'model', object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }],
          x_gateway: { resolvedProvider: 'fixture', resolvedModel: 'model', fallbackUsed: false,
            tokensUsed: 3, inputTokens: 1, outputTokens: 2 },
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } });
      } else {
        assert.match(String(body.id), /^msg_/);
        assert.deepEqual(body, { id: body.id, type: 'message', role: 'assistant', model: 'model',
          content: [{ type: 'text', text: 'answer' }], stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 2 } });
      }
    });
  }

  it('preserves generate validation 400 without calling the router', async () => {
    const { app, calls } = fixture();
    const response = await post(app, '/v1/generate', {});
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: INVALID, code: 'VALIDATION_ERROR', field: '' });
    assert.deepEqual(calls, []);
  });

  it('preserves genuine missing-user chat 400 before provider execution', async () => {
    const { app, calls } = fixture();
    const response = await post(app, '/v1/chat/completions', { messages: [{ role: 'assistant', content: 'hello' }] });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: { message: INVALID, type: 'invalid_request_error', code: null } });
    assert.deepEqual(calls, []);
  });

  it('preserves Anthropic invalid-JSON 400 without testing excluded TransformError projection', async () => {
    const { app, calls } = fixture();
    const response = await app.request('/v1/messages', { method: 'POST', body: '{' });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON body' } });
    assert.deepEqual(calls, []);
  });

  for (const length of [512_000, 512_001]) {
    it(`preserves the generate prompt boundary at ${length} characters`, async () => {
      const { app, calls } = fixture();
      const response = await post(app, '/v1/generate', { prompt: 'x'.repeat(length) });
      assert.equal(response.status, length === 512_000 ? 200 : 400);
      assert.equal(calls.length, length === 512_000 ? 1 : 0);
      if (length === 512_001) assert.deepEqual(await response.json(), { error: INVALID, code: 'VALIDATION_ERROR', field: 'prompt' });
    });
  }

  it('does not let a provider spoof request validation by reusing its error text', async () => {
    const { app } = fixture(() => { throw new Error(CHAT_COMPLETIONS_USER_MESSAGE_REQUIRED); });
    const response = await post(app, requests[1].path, requests[1].body);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), requests[1].error);
  });
});
