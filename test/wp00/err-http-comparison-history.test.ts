import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { ComparisonStore } from '../../src/comparison/persistence.js';
import { ComparisonService } from '../../src/comparison/service.js';
import type { CompareResponse } from '../../src/comparison/types.js';
import { Router } from '../../src/core/router.js';
import { registerComparisonRoutes } from '../../src/server/routes/comparison.js';

const PATH = '/v1/compare/history';
const CANARY = 'private-comparison-diagnostic';
const SAFE = 'An unexpected internal error occurred.';

function snapshot(id = 'fixture'): CompareResponse {
  return {
    id, prompt: 'Intentional user prompt', createdAt: '2026-09-07T00:00:00.000Z',
    results: [
      { model: 'success-model', provider: 'fixture', status: 'success', response: 'Intentional model output',
        tokensIn: 12, tokensOut: 8, costUsd: 0.25, latencyMs: 45, finishReason: 'stop', stabilityScore: 77 },
      { model: 'failed-model', provider: 'other', status: 'error',
        tokensIn: 0, tokensOut: 0, costUsd: null, latencyMs: 90 },
      { model: 'timeout-model', provider: 'other', status: 'timeout',
        tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 100 },
    ],
    summary: { fastestModel: 'success-model', cheapestModel: 'success-model', totalCost: 0.25, wallClockMs: 100 },
  };
}

async function fixture(run: (app: Hono, service: ComparisonService, store: ComparisonStore) => Promise<void>) {
  const db = new Database(':memory:');
  try {
    const store = new ComparisonStore(db);
    const router = new Router();
    router.generateFromInternal = async () => { assert.fail('History must never invoke generation'); };
    const service = new ComparisonService(router, { store, maxCostCeiling: 1 });
    const original = service.getHistory;
    const app = new Hono();
    app.onError(() => new Response('Unexpected framework fallback', { status: 599 }));
    registerComparisonRoutes(app, { comparisonService: service });
    try { await run(app, service, store); }
    finally { service.getHistory = original; }
  } finally { db.close(); }
}

describe('Comparison history HTTP containment', () => {
  for (const kind of ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked']) {
    it('contains unknown ' + kind + ' without inspection', async () => {
      await fixture(async (app, service) => {
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
        service.getHistory = () => { calls++; throw value; };
        const res = await app.request(PATH);
        assert.equal(res.status, 500);
        assert.deepEqual(await res.json(), { error: SAFE });
        assert.equal(accesses, 0);
        assert.equal(calls, 1);
      });
    });
  }

  it('contains persisted diagnostics without rewriting history or intended successful fields', async () => {
    await fixture(async (app, _service, store) => {
      const input = snapshot();
      for (const result of input.results.slice(1)) result.error = CANARY;
      store.save(input, 'Stored system prompt', undefined, 'project-a');
      const before = store.getById(input.id);
      const expected = snapshot();
      for (const result of expected.results.slice(1)) result.error = SAFE;
      const res = await app.request(PATH + '?project=project-a');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, { results: [expected], count: 1 });
      assert.equal(JSON.stringify(body).includes(CANARY), false);
      assert.deepEqual(store.getById(input.id), before);
      assert.deepEqual(before, input);
    });
  });

  for (const kind of ['getter', 'absent', 'undefined', 'null']) {
    it('preserves diagnostic presence ' + kind + ' without reading getters or mutating input', async () => {
      await fixture(async (app, service) => {
        const input = snapshot();
        const expected = snapshot();
        const result = input.results[1];
        const projected = expected.results[1];
        assert.ok(result);
        assert.ok(projected);
        let accesses = 0;
        if (kind !== 'absent') Object.defineProperty(result, 'error', kind === 'getter'
          ? { enumerable: true, get() { accesses++; throw new Error(CANARY); } }
          : { enumerable: true, value: kind === 'null' ? null : undefined });
        if (kind === 'getter') projected.error = SAFE;
        if (kind === 'null') Object.defineProperty(projected, 'error', { enumerable: true, value: null });
        const descriptor = Object.getOwnPropertyDescriptor(result, 'error');
        for (const item of input.results) Object.freeze(item);
        Object.freeze(input.results);
        Object.freeze(input.summary);
        Object.freeze(input);
        service.getHistory = () => [input];
        const res = await app.request(PATH);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { results: [expected], count: 1 });
        assert.equal(accesses, 0);
        assert.deepEqual(Object.getOwnPropertyDescriptor(result, 'error'), descriptor);
      });
    });
  }

  for (const [query, limit, offset] of [
    ['', 20, 0], ['?limit=bad&offset=bad', 20, 0], ['?limit=0&offset=-4', 1, 0],
    ['?limit=999&offset=2tail', 100, 2], ['?limit=3tail&offset=1', 3, 1],
  ] as const) {
    it('preserves pagination parsing ' + (query || '(defaults)'), async () => {
      await fixture(async (app, service) => {
        service.getHistory = (filters) => {
          assert.deepEqual(filters, { project: undefined, limit, offset });
          return [];
        };
        const res = await app.request(PATH + query);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { results: [], count: 0 });
      });
    });
  }

  it('preserves real project filtering, newest-first ordering and pagination', async () => {
    await fixture(async (app, _service, store) => {
      for (const [id, date, project] of [['old', '01', 'a'], ['new', '03', 'a'], ['other', '02', 'b']]) {
        const row = snapshot(id);
        row.createdAt = '2026-09-' + date + 'T00:00:00.000Z';
        store.save(row, undefined, undefined, project);
      }
      const res = await app.request(PATH + '?project=a&limit=1&offset=1');
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { results: [store.getById('old')], count: 1 });
    });
  });

  it('preserves empty history without a store and route absence without a service', async () => {
    const app = new Hono();
    registerComparisonRoutes(app, { comparisonService: new ComparisonService(new Router(), { maxCostCeiling: 1 }) });
    const res = await app.request(PATH);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { results: [], count: 0 });
    const absent = new Hono();
    registerComparisonRoutes(absent, {});
    assert.equal((await absent.request(PATH)).status, 404);
  });
});
