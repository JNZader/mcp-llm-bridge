import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { ComparisonService, CostExceededError } from '../../src/comparison/service.js';
import type { CompareResponse } from '../../src/comparison/types.js';
import { Router } from '../../src/core/router.js';
import { registerComparisonRoutes } from '../../src/server/routes/comparison.js';

const CANARY = 'private-comparison-action-canary';
const SAFE = 'An unexpected internal error occurred.';
// Fixed public copy approved for this unit; distinct from BUDGET_EXCEEDED 403.
const BUDGET = 'Estimated cost exceeds the configured limit.';
const INPUT = { prompt: 'Intentional prompt', models: ['fixture-a', 'fixture-b'] };

async function fixture(run: (app: Hono, service: ComparisonService, router: Router) => Promise<void>, ceiling = 1) {
  const router = new Router();
  const generate = router.generateFromInternal;
  const service = new ComparisonService(router, { maxCostCeiling: ceiling });
  const compare = service.compare;
  router.generateFromInternal = async () => { assert.fail('Unexpected provider execution'); };
  const app = new Hono();
  app.onError(() => new Response('Unexpected framework fallback', { status: 599 }));
  registerComparisonRoutes(app, { comparisonService: service });
  try { await run(app, service, router); }
  finally { service.compare = compare; router.generateFromInternal = generate; }
}

function post(app: Hono, body: unknown = INPUT) {
  return app.request('/v1/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('Comparison action HTTP containment', () => {
  for (const kind of ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked', 'impostor', 'wrapped']) {
    it('contains unknown ' + kind + ' without inspecting or granting budget identity', async () => {
      await fixture(async (app, service) => {
        let accesses = 0;
        const inspect = () => { accesses++; throw new Error(CANARY); };
        let value: unknown = new Error(CANARY);
        if (kind === 'string') value = CANARY;
        if (kind === 'getter') value = Object.defineProperty(new Error(), 'message', { get: inspect });
        if (kind === 'coercion') value = { [Symbol.toPrimitive]: inspect, toString: inspect };
        if (kind === 'proxy') value = new Proxy({}, { get: inspect, getPrototypeOf: inspect });
        if (kind === 'impostor') value = Object.create(CostExceededError.prototype);
        if (kind === 'wrapped') value = new Proxy(new CostExceededError(2, 1), {});
        if (kind === 'revoked') {
          const proxy = Proxy.revocable({}, {});
          proxy.revoke();
          value = proxy.proxy;
        }
        let calls = 0;
        service.compare = async () => { calls++; throw value; };
        const res = await post(app);
        assert.equal(res.status, 500);
        assert.deepEqual(await res.json(), { error: SAFE });
        assert.equal(accesses, 0);
        assert.equal(calls, 1);
      });
    });
  }

  for (const mutation of ['values', 'getters']) {
    it('preserves constructor-captured budget values despite public ' + mutation, async () => {
      await fixture(async (app, service) => {
        const error = new CostExceededError(2, 1);
        assert.ok(error instanceof CostExceededError);
        let accesses = 0;
        for (const field of ['message', 'estimatedCost', 'limit']) {
          Object.defineProperty(error, field, mutation === 'values'
            ? { value: field === 'message' ? CANARY : 999 }
            : { get() { accesses++; throw new Error(CANARY); } });
        }
        service.compare = async () => { throw error; };
        const res = await post(app);
        assert.equal(res.status, 422);
        assert.deepEqual(await res.json(), { error: BUDGET, code: 'COST_EXCEEDED', estimatedCost: 2, limit: 1 });
        assert.equal(accesses, 0);
      });
    });
  }

  for (const requested of [0.00001, 5]) {
    it('enforces the real cost ceiling before fan-out for requested limit ' + requested, async () => {
      await fixture(async (app, _service, router) => {
        let calls = 0;
        router.generateFromInternal = async () => { calls++; assert.fail('Budget rejection must precede fan-out'); };
        const res = await post(app, { ...INPUT, models: ['gpt-4o', 'gpt-4o-mini'], maxTokens: 100, maxEstimatedCost: requested });
        assert.equal(res.status, 422);
        const body = await res.json();
        assert.equal(body.error, BUDGET);
        assert.equal(body.code, 'COST_EXCEEDED');
        // Static pricing: 500 input tokens and 100 output tokens for each model.
        assert.ok(Math.abs(body.estimatedCost - 0.002385) < 1e-12);
        assert.equal(body.limit, Math.min(requested, 0.001));
        assert.equal(calls, 0);
      }, 0.001);
    });
  }

  it('contains real mixed service diagnostics while preserving successful output and statuses', async () => {
    await fixture(async (app, _service, router) => {
      const calls: string[] = [];
      router.generateFromInternal = async (req) => {
        calls.push(req.model ?? '');
        if (req.model === 'failure') throw new Error(CANARY);
        if (req.model === 'timeout') throw Object.assign(new Error(CANARY), { name: 'AbortError' });
        return { content: 'Intentional output', usage: { totalTokens: 5 }, model: 'success',
          finishReason: 'stop', metadata: { provider: 'fixture', latencyMs: 12 } };
      };
      const res = await post(app, { ...INPUT, models: ['success', 'failure', 'timeout'] });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(calls, ['success', 'failure', 'timeout']);
      assert.equal(body.prompt, INPUT.prompt);
      assert.equal(typeof body.id, 'string');
      assert.ok(Number.isFinite(Date.parse(body.createdAt)));
      assert.deepEqual(body.results[0], { model: 'success', provider: 'fixture', status: 'success',
        response: 'Intentional output', tokensIn: 0, tokensOut: 0, costUsd: null, latencyMs: 12, finishReason: 'stop' });
      for (const [index, status] of [[1, 'error'], [2, 'timeout']] as const) {
        assert.equal(body.results[index].status, status);
        assert.equal(body.results[index].error, SAFE);
      }
      assert.equal(body.summary.fastestModel, 'success');
      assert.equal(body.summary.totalCost, 0);
      assert.ok(body.summary.wallClockMs >= 0);
      assert.equal(JSON.stringify(body).includes(CANARY), false);
    });
  });

  for (const kind of ['getter', 'absent', 'undefined', 'null']) {
    it('projects supplied result diagnostic ' + kind + ' without mutation', async () => {
      await fixture(async (app, service) => {
        const input: CompareResponse = { id: 'fixture', prompt: INPUT.prompt, createdAt: '2026-09-07T00:00:00.000Z',
          results: [{ model: 'fixture', provider: 'fixture-provider', status: 'error', tokensIn: 3, tokensOut: 0,
            costUsd: null, latencyMs: 9, finishReason: 'stop', stabilityScore: 55 }], summary: { totalCost: 0, wallClockMs: 9 } };
        const expected = structuredClone(input);
        const result = input.results[0];
        const projected = expected.results[0];
        assert.ok(result);
        assert.ok(projected);
        let accesses = 0;
        if (kind !== 'absent') Object.defineProperty(result, 'error', kind === 'getter'
          ? { enumerable: true, get() { accesses++; throw new Error(CANARY); } }
          : { enumerable: true, value: kind === 'null' ? null : undefined });
        if (kind === 'getter') projected.error = SAFE;
        if (kind === 'null') Object.defineProperty(projected, 'error', { enumerable: true, value: null });
        const descriptor = Object.getOwnPropertyDescriptor(result, 'error');
        Object.freeze(result);
        Object.freeze(input.results);
        Object.freeze(input.summary);
        Object.freeze(input);
        service.compare = async () => input;
        const res = await post(app);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), expected);
        assert.equal(accesses, 0);
        assert.deepEqual(Object.getOwnPropertyDescriptor(result, 'error'), descriptor);
      });
    });
  }
});
