import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { LocalLLMStatus } from '../../src/local-llm/types.js';
import { registerToolingRoutes, type ToolingRouteDeps } from '../../src/server/routes/tooling.js';

const CANARY = 'private-local-model-diagnostic';
const SAFE = 'An unexpected internal error occurred.';

function snapshot(): LocalLLMStatus {
  return {
    enabled: true, ready: true, readyReason: 'At least one local model is available',
    checkedAt: '2026-09-07T00:00:00.000Z', source: 'cache', cacheHit: true,
    backendCount: 3, connectedBackendCount: 1, disconnectedBackendCount: 1,
    errorBackendCount: 1, modelCount: 1,
    backends: [
      { backend: 'ollama', status: 'connected', baseUrl: 'http://offline.invalid:11434',
        modelCount: 1, models: [{ id: 'fixture:3b', name: 'Fixture Model', backend: 'ollama',
          parameterSize: 3, contextWindow: 8192, loaded: true }] },
      { backend: 'lm-studio', status: 'error', baseUrl: 'http://offline.invalid:1234',
        modelCount: 0, models: [] },
      { backend: 'ollama', status: 'disconnected', baseUrl: 'http://offline.invalid:11435',
        modelCount: 0, models: [] },
    ],
  };
}

function appFor(read: NonNullable<ToolingRouteDeps['getLocalLLMStatus']>) {
  const app = new Hono();
  app.onError(() => new Response('Unexpected framework fallback', { status: 599 }));
  registerToolingRoutes(app, { getLocalLLMStatus: read });
  return app;
}

describe('Local model HTTP containment', { concurrency: false }, () => {
  for (const kind of ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked']) {
    it('contains thrown ' + kind + ' without inspecting it', async () => {
      let accesses = 0;
      const inspect = () => { accesses++; throw new Error(CANARY); };
      let value: unknown = new Error(CANARY);
      if (kind === 'string') value = CANARY;
      if (kind === 'getter') value = Object.defineProperty(new Error(), 'message', { get: inspect });
      if (kind === 'coercion') value = { [Symbol.toPrimitive]: inspect, toString: inspect };
      if (kind === 'proxy') value = new Proxy({}, { get: inspect, getPrototypeOf: inspect });
      if (kind === 'revoked') {
        const proxy = Proxy.revocable({}, {});
        proxy.revoke();
        value = proxy.proxy;
      }
      let calls = 0;
      const app = appFor(async () => { calls++; throw value; });
      const res = await app.request('/v1/local/models');
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { error: SAFE });
      assert.equal(calls, 1);
      assert.equal(accesses, 0);
    });
  }

  for (const kind of ['string', 'getter', 'absent', 'undefined', 'null']) {
    it('preserves partial availability and projects diagnostic ' + kind, async () => {
      const input = snapshot();
      const expected = snapshot();
      const backend = input.backends[1];
      const projected = expected.backends[1];
      assert.ok(backend);
      assert.ok(projected);
      let accesses = 0;
      if (kind !== 'absent') {
        const descriptor = kind === 'getter'
          ? { enumerable: true, get() { accesses++; throw new Error(CANARY); } }
          : { enumerable: true, value: kind === 'string' ? CANARY : kind === 'null' ? null : undefined };
        assert.equal(Reflect.defineProperty(backend, 'error', descriptor), true);
      }
      if (kind === 'string' || kind === 'getter') projected.error = SAFE;
      if (kind === 'null') assert.equal(Reflect.defineProperty(projected, 'error', { value: null, enumerable: true }), true);
      const descriptorBefore = Object.getOwnPropertyDescriptor(backend, 'error');
      for (const item of input.backends) {
        for (const model of item.models) Object.freeze(model);
        Object.freeze(item.models);
        Object.freeze(item);
      }
      Object.freeze(input.backends);
      Object.freeze(input);
      const app = appFor(async () => input);
      const res = await app.request('/v1/local/models');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, expected);
      assert.equal(JSON.stringify(body).includes(CANARY), false);
      assert.equal(accesses, 0);
      assert.deepEqual(Object.getOwnPropertyDescriptor(backend, 'error'), descriptorBefore);
    });
  }

  for (const enabled of [false, true]) {
    it('preserves detector configuration and options when enabled=' + enabled, async () => {
      const keys = ['LOCAL_LLM_ENABLED', 'OLLAMA_URL', 'LM_STUDIO_URL'];
      const before = keys.map((key) => process.env[key]);
      try {
        process.env['LOCAL_LLM_ENABLED'] = String(enabled);
        process.env['OLLAMA_URL'] = 'http://offline.invalid:11434';
        process.env['LM_STUDIO_URL'] = 'http://offline.invalid:1234';
        const input = snapshot();
        input.enabled = enabled;
        input.ready = enabled;
        input.source = enabled ? 'probe' : 'disabled';
        input.cacheHit = false;
        input.readyReason = enabled ? 'At least one local model is available' : 'Local LLM is disabled by runtime flag';
        let calls = 0;
        const app = appFor(async (config, options) => {
          calls++;
          assert.deepEqual(config, { enabled, ollamaUrl: 'http://offline.invalid:11434', lmStudioUrl: 'http://offline.invalid:1234' });
          assert.deepEqual(options, enabled ? undefined : { skipDetectionWhenDisabled: true });
          return input;
        });
        const res = await app.request('/v1/local/models');
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), input);
        assert.equal(calls, 1);
      } finally {
        keys.forEach((key, index) => {
          const value = before[index];
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        });
      }
    });
  }
});
