import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { ComparisonService } from '../../src/comparison/service.js';
import type { CompareResponse } from '../../src/comparison/types.js';
import { Router } from '../../src/core/router.js';
import { registerComparisonRoutes } from '../../src/server/routes/comparison.js';

const CANARY = 'private-comparison-validation-canary';
const INPUT = { prompt: 'Intentional prompt', models: ['fixture-a', 'fixture-b'] };
const RESULT: CompareResponse = { id: 'fixture', prompt: INPUT.prompt, results: [],
  summary: { totalCost: 0, wallClockMs: 0 }, createdAt: '2026-09-07T00:00:00.000Z' };

async function fixture(run: (app: Hono, service: ComparisonService) => Promise<void>) {
  const router = new Router();
  const generate = router.generateFromInternal;
  const service = new ComparisonService(router);
  const compare = service.compare;
  router.generateFromInternal = async () => { assert.fail('Unexpected provider execution'); };
  const app = new Hono();
  app.onError(() => new Response('Unexpected framework fallback', { status: 599 }));
  registerComparisonRoutes(app, { comparisonService: service });
  try { await run(app, service); }
  finally { service.compare = compare; router.generateFromInternal = generate; }
}

function post(app: Hono, body: unknown) {
  return app.request('/v1/compare', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('Comparison local validation HTTP containment', () => {
  const invalid: Array<[string, unknown, string]> = [
    ['missing prompt', { models: INPUT.models }, 'prompt'],
    ['empty prompt', { ...INPUT, prompt: '' }, 'prompt'],
    ['oversized prompt', { ...INPUT, prompt: 'x'.repeat(512001) }, 'prompt'],
    ['prompt type', { ...INPUT, prompt: { [CANARY]: true } }, 'prompt'],
    ['system type', { ...INPUT, system: [CANARY] }, 'system'],
    ['missing models', { prompt: INPUT.prompt }, 'models'],
    ['model list type', { ...INPUT, models: CANARY }, 'models'],
    ['one model', { ...INPUT, models: [CANARY] }, 'models'],
    ['six models', { ...INPUT, models: ['a', 'b', 'c', 'd', 'e', CANARY] }, 'models'],
    ['duplicate models', { ...INPUT, models: [CANARY, CANARY] }, 'models'],
    ['nested model type', { ...INPUT, models: ['a', { [CANARY]: true }] }, 'models'],
    ['token coercion', { ...INPUT, maxTokens: CANARY }, 'maxTokens'],
    ['token zero', { ...INPUT, maxTokens: 0 }, 'maxTokens'],
    ['token fraction', { ...INPUT, maxTokens: 1.5 }, 'maxTokens'],
    ['timeout coercion', { ...INPUT, timeoutMs: '100' }, 'timeoutMs'],
    ['timeout zero', { ...INPUT, timeoutMs: 0 }, 'timeoutMs'],
    ['timeout fraction', { ...INPUT, timeoutMs: 1.5 }, 'timeoutMs'],
    ['timeout maximum', { ...INPUT, timeoutMs: 120001 }, 'timeoutMs'],
    ['cost coercion', { ...INPUT, maxEstimatedCost: '1' }, 'maxEstimatedCost'],
    ['cost zero', { ...INPUT, maxEstimatedCost: 0 }, 'maxEstimatedCost'],
    ['persist coercion', { ...INPUT, persist: 'false' }, 'persist'],
    ['project type', { ...INPUT, project: [CANARY] }, 'project'],
    ['root null', null, ''],
    ['root array', [CANARY], ''],
  ];
  for (const [name, input, field] of invalid) {
    it('projects a finite local validation result for ' + name, async () => {
      await fixture(async (app, service) => {
        let calls = 0;
        service.compare = async () => { calls++; return RESULT; };
        const res = await post(app, input);
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.deepEqual(body, { error: 'The request is invalid.', code: 'VALIDATION_ERROR', field });
        assert.equal(JSON.stringify(body).includes(CANARY), false);
        assert.equal(calls, 0);
      });
    });
  }

  it('preserves defaults and strips unknown fields before calling the service', async () => {
    await fixture(async (app, service) => {
      const calls: unknown[] = [];
      service.compare = async (input) => { calls.push(input); return RESULT; };
      const res = await post(app, { ...INPUT, unknown: CANARY });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), RESULT);
      assert.deepEqual(calls, [{ ...INPUT, maxTokens: 1024, timeoutMs: 30000, persist: false }]);
    });
  });

  it('accepts exact bounds and preserves intentional optional values without coercion', async () => {
    await fixture(async (app, service) => {
      const input = { prompt: 'x'.repeat(512000), models: ['a', 'b', 'c', 'd', 'e'],
        system: '', maxTokens: 1, timeoutMs: 120000, maxEstimatedCost: 0.01, persist: true, project: CANARY };
      const calls: unknown[] = [];
      service.compare = async (request) => { calls.push(request); return RESULT; };
      const res = await post(app, input);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), RESULT);
      assert.deepEqual(calls, [input]);
    });
  });

  it('keeps malformed JSON as a contained 500 without calling the service', async () => {
    await fixture(async (app, service) => {
      let calls = 0;
      service.compare = async () => { calls++; return RESULT; };
      const res = await app.request('/v1/compare', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: '{' + CANARY });
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { error: 'An unexpected internal error occurred.' });
      assert.equal(calls, 0);
    });
  });

  for (const kind of ['fake issues', 'hostile issues getter']) {
    it('does not classify downstream ' + kind + ' as local validation', async () => {
      await fixture(async (app, service) => {
        let accesses = 0;
        const failure = kind === 'fake issues'
          ? { issues: [{ path: [CANARY], message: CANARY }] }
          : Object.defineProperty({}, 'issues', { get() { accesses++; throw new Error(CANARY); } });
        let calls = 0;
        service.compare = async () => { calls++; throw failure; };
        const res = await post(app, INPUT);
        assert.equal(res.status, 500);
        assert.deepEqual(await res.json(), { error: 'An unexpected internal error occurred.' });
        assert.equal(calls, 1);
        assert.equal(accesses, 0);
      });
    });
  }
});
