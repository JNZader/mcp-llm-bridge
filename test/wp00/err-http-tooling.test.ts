import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { ToolCatalog } from '../../src/tool-catalog/index.js';
import { registerToolingRoutes, type ToolingRouteDeps } from '../../src/server/routes/tooling.js';

const SAFE = 'An unexpected internal error occurred.';
const CANARY = 'private-tooling-error-canary';

function appFor(deps: ToolingRouteDeps = {}) {
  const app = new Hono();
  app.onError(() => new Response('Unexpected framework fallback', { status: 599 }));
  registerToolingRoutes(app, deps);
  return app;
}

function catalogFixture() {
  const catalog = new ToolCatalog();
  const first = catalog.register({ name: 'semantic_search', source: 'mcp',
    description: 'Semantic search', parameters: { type: 'object' }, tags: ['semantic'] });
  const second = catalog.register({ name: 'lookup', source: 'custom',
    description: 'Semantic lookup', parameters: { required: ['query'] }, tags: [] });
  return { catalog, first, second };
}

describe('Tooling HTTP error containment', () => {
  for (const path of ['/v1/tools/catalog', '/v1/tools/search', '/v1/balancer/strategies']) {
    for (const kind of ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked']) {
      it(path + ': contains ' + kind + ' without inspecting it', async () => {
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
        const app = appFor({ getToolCatalog: () => ({ listAll: fail, search: fail }),
          getStrategies: async () => fail() });
        const res = await app.request(path);
        assert.equal(res.status, 500);
        assert.deepEqual(await res.json(), { error: SAFE });
        assert.equal(accesses, 0);
        assert.equal(calls, 1);
      });
    }
  }

  for (const path of ['/v1/tools/catalog', '/v1/tools/search']) {
    it(path + ': contains catalog construction failure', async () => {
      const app = appFor({ getToolCatalog: () => { throw new Error(CANARY); } });
      const res = await app.request(path);
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { error: SAFE });
    });
  }

  it('preserves catalog metadata, source filtering and unknown-source empty results', async () => {
    const { catalog, first, second } = catalogFixture();
    const app = appFor({ getToolCatalog: () => catalog });
    for (const [query, tools] of [
      ['', [first, second]], ['?source=mcp', [first]], ['?source=custom', [second]],
      ['?source=unknown', []],
    ] as const) {
      const res = await app.request('/v1/tools/catalog' + query);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { count: tools.length, tools });
    }
  });

  it('preserves search ranking and metadata while omitting catalog timestamps', async () => {
    const { catalog, first, second } = catalogFixture();
    const app = appFor({ getToolCatalog: () => catalog });
    const res = await app.request('/v1/tools/search?q=semantic');
    assert.equal(res.status, 200);
    const expected = [first, second].map(({ addedAt: _addedAt, ...entry }) => entry);
    const body = await res.json();
    assert.deepEqual(body, { query: 'semantic', count: 2, tools: expected });
    assert.equal(JSON.stringify(body).includes('addedAt'), false);
  });

  for (const [query, expectedLimit, count] of [
    ['', 10, 2], ['&limit=nonsense', 10, 2], ['&limit=1tail', 1, 1],
    ['&limit=0', 0, 0], ['&limit=-1', -1, 1],
  ] as const) {
    it('preserves search limit parsing ' + (query || '(default)'), async () => {
      const { catalog } = catalogFixture();
      let calls = 0;
      const app = appFor({ getToolCatalog: () => ({
        listAll: (source) => catalog.listAll(source),
        search: (text, limit) => {
          calls++;
          assert.equal(text, 'semantic');
          assert.equal(limit, expectedLimit);
          return catalog.search(text, limit);
        },
      }) });
      const res = await app.request('/v1/tools/search?q=semantic' + query);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.query, 'semantic');
      assert.equal(body.count, count);
      assert.equal(body.tools.length, count);
      assert.equal(calls, 1);
    });
  }

  it('preserves default query and unmatched empty results', async () => {
    const { catalog } = catalogFixture();
    const app = appFor({ getToolCatalog: () => catalog });
    for (const query of ['', 'unmatched']) {
      const res = await app.request('/v1/tools/search' + (query ? '?q=' + query : ''));
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { query, count: 0, tools: [] });
    }
  });

  it('preserves the real default strategy producer without selecting providers', async () => {
    const res = await appFor().request('/v1/balancer/strategies');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { strategies: [
      { mode: 'round_robin', description: 'Cycles through providers sequentially' },
      { mode: 'random', description: 'Randomly selects from available providers' },
      { mode: 'failover', description: 'Selects by priority, falls back on failure' },
      { mode: 'weighted', description: 'Selects based on configured weight distribution' },
    ] });
  });

  it('preserves default runtime catalog registration without executing tools', async () => {
    const res = await appFor().request('/v1/tools/catalog?source=mcp');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.count, body.tools.length);
    assert.ok(body.tools.some((tool: { name: string }) => tool.name === 'code_search'));
    assert.ok(body.tools.every((tool: { source: string }) => tool.source === 'mcp'));
  });
});
