import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { Router } from '../../src/core/router.js';
import { estimateCost, getPriceTable } from '../../src/core/pricing.js';
import { costEstimateQuerySchema } from '../../src/core/schemas.js';
import { registerMetadataRoutes, type MetadataPricing } from '../../src/server/routes/metadata.js';

const CANARY = 'private-cost-error-canary';
const SAFE = 'An unexpected internal error occurred.';
const VALID = '/v1/cost/estimate?model=gpt-4o&inputTokens=1000&outputTokens=500';

function appFor(pricing?: MetadataPricing) {
  const app = new Hono();
  app.onError(() => new Response('Unexpected framework fallback', { status: 599 }));
  registerMetadataRoutes(app, { router: new Router(), pricing });
  return app;
}

describe('Cost HTTP failure containment', { concurrency: false }, () => {
  for (const path of [VALID, '/v1/cost/models']) {
    for (const kind of ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked']) {
      it(path + ': contains ' + kind + ' without inspecting unknown failures', async () => {
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
        const fail = () => { calls++; throw value; };
        const res = await appFor({ estimateCost: fail, getPriceTable: fail }).request(path);
        assert.equal(res.status, 500);
        assert.equal(calls, 1);
        assert.equal(accesses, 0);
        assert.deepEqual(await res.json(), { error: SAFE });
      });
    }
  }

  for (const [field, value] of [
    ['model', undefined], ['model', ''],
    ['inputTokens', undefined], ['inputTokens', CANARY], ['inputTokens', '-1'], ['inputTokens', '1.5'],
    ['outputTokens', undefined], ['outputTokens', CANARY], ['outputTokens', '-1'], ['outputTokens', '1.5'],
  ] as const) {
    it('real schema: finite validation details for ' + field + '=' + value, async () => {
      const query = new URLSearchParams({ model: 'gpt-4o', inputTokens: '1', outputTokens: '2' });
      if (value === undefined) query.delete(field);
      else query.set(field, value);
      let calls = 0;
      const fail = () => { calls++; throw new Error('Pricing must not run'); };
      const res = await appFor({ estimateCost: fail, getPriceTable: fail })
        .request('/v1/cost/estimate?' + query);
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: 'Validation error', details: field + ': Invalid value' });
      assert.equal(calls, 0);
    });
  }

  // Synthetic library-boundary cases, not claims about attacker-controlled real Zod issues.
  for (const path of [['model'], [CANARY], ['constructor'], [{ toString() { throw new Error(CANARY); } }], []]) {
    it('synthetic schema: never joins or reflects an unapproved issue path', async () => {
      const original = costEstimateQuerySchema.safeParse;
      let accesses = 0;
      const failure = original({ model: '', inputTokens: 1, outputTokens: 2 });
      assert.equal(failure.success, false);
      const error = failure.error;
      const issue = error.issues[0];
      assert.ok(issue);
      Object.defineProperty(issue, 'path', { value: path });
      Object.defineProperty(issue, 'message', { get() { accesses++; throw new Error(CANARY); } });
      try {
        costEstimateQuerySchema.safeParse = () => ({ success: false, error });
        const res = await appFor().request(VALID);
        assert.equal(res.status, 400);
        assert.equal(accesses, 0);
        assert.deepEqual(await res.json(), { error: 'Validation error',
          details: path[0] === 'model' ? 'model: Invalid value' : 'Invalid query parameters' });
      } finally {
        costEstimateQuerySchema.safeParse = original;
      }
    });
  }

  it('uses default pricing functions and the real known-model calculation', async () => {
    const res = await appFor().request(VALID);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      model: 'gpt-4o', inputTokens: 1000, outputTokens: 500,
      estimatedCost: (1000 / 1_000_000) * 2.5 + (500 / 1_000_000) * 10,
      pricePerMTok: { input: 2.5, output: 10 }, currency: 'USD',
    });
    const table = await appFor().request('/v1/cost/models');
    assert.equal(table.status, 200);
    const body = await table.json();
    assert.deepEqual(body, getPriceTable());
    assert.deepEqual(body['gpt-4o'], { inputPerMTok: 2.5, outputPerMTok: 10 });
  });

  it('preserves unknown-model 400 and zero-token success', async () => {
    const unknown = await appFor().request('/v1/cost/estimate?model=' + CANARY + '&inputTokens=0&outputTokens=0');
    assert.equal(unknown.status, 400);
    assert.deepEqual(await unknown.json(), { error: 'Unknown model' });
    const zero = await appFor().request('/v1/cost/estimate?model=gpt-4o&inputTokens=0&outputTokens=0');
    assert.equal(zero.status, 200);
    assert.deepEqual(await zero.json(), {
      model: 'gpt-4o', inputTokens: 0, outputTokens: 0, estimatedCost: 0,
      pricePerMTok: { input: 2.5, output: 10 }, currency: 'USD',
    });
  });

  it('passes coerced arguments to explicitly supplied pricing and preserves its successful response', async () => {
    const calls: unknown[][] = [];
    const pricing: MetadataPricing = {
      estimateCost(...args) { calls.push(args); return estimateCost(...args); },
      getPriceTable,
    };
    const res = await appFor(pricing).request(VALID);
    assert.equal(res.status, 200);
    assert.deepEqual(calls, [['gpt-4o', 1000, 500]]);
    assert.deepEqual(await res.json(), estimateCost('gpt-4o', 1000, 500));
  });
});
