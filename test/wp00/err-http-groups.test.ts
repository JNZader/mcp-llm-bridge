import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { GroupStore, type CreateGroupInput } from '../../src/core/groups.js';
import { registerGroupRoutes } from '../../src/server/routes/groups.js';

const CANARY = 'private-group-canary';
const SAFE = 'An unexpected internal error occurred.';
const INPUT: CreateGroupInput = { name: 'Fixture group', members: [{ provider: 'fixture' }], strategy: 'weighted' };

async function fixture(run: (app: Hono, store: GroupStore) => Promise<void>) {
  const store = new GroupStore(':memory:');
  const methods = { list: store.list, create: store.create, update: store.update, delete: store.delete };
  const app = new Hono();
  app.onError(() => new Response('Unexpected framework fallback', { status: 599 }));
  registerGroupRoutes(app, { groupStore: store });
  try {
    await run(app, store);
  } finally {
    Object.assign(store, methods);
    store.close();
  }
}

function request(app: Hono, method: string, path: string, body?: unknown) {
  return app.request(path, { method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

describe('Group HTTP containment', { concurrency: false }, () => {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    for (const kind of ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked', 'issues']) {
      it(method + ': contains store ' + kind + ' without inspection', async () => {
        await fixture(async (app, store) => {
          let accesses = 0;
          const inspect = () => { accesses++; throw new Error(CANARY); };
          let value: unknown = new Error(CANARY);
          if (kind === 'string') value = CANARY;
          if (kind === 'getter') value = Object.defineProperty(new Error(), 'message', { get: inspect });
          if (kind === 'coercion') value = { [Symbol.toPrimitive]: inspect, toString: inspect };
          if (kind === 'proxy') value = new Proxy({}, { get: inspect, getPrototypeOf: inspect });
          if (kind === 'issues') value = { issues: [{ message: CANARY, path: ['weights', CANARY] }] };
          if (kind === 'revoked') {
            const proxy = Proxy.revocable({}, {});
            proxy.revoke();
            value = proxy.proxy;
          }
          let calls = 0;
          const fail = () => { calls++; throw value; };
          store.list = fail;
          store.create = fail;
          store.update = fail;
          store.delete = fail;
          const path = '/v1/groups' + (method === 'PUT' || method === 'DELETE' ? '/fixture' : '');
          const res = await request(app, method, path, method === 'POST' ? INPUT : method === 'PUT' ? {} : undefined);
          assert.equal(res.status, 500);
          assert.deepEqual(await res.json(), { error: SAFE });
          assert.equal(accesses, 0);
          assert.equal(calls, 1);
        });
      });
    }
  }

  for (const method of ['POST', 'PUT']) {
    for (const [field, invalid] of [
      ['name', ''], ['modelPattern', 3], ['members', [{ provider: '' }]],
      ['strategy', CANARY], ['weights', { [CANARY]: -1 }], ['stickyTTL', '30'],
    ] as const) {
      it(method + ': publishes only finite validation field ' + field, async () => {
        await fixture(async (app, store) => {
          let calls = 0;
          const unexpected = () => { calls++; throw new Error('Store must not receive invalid input'); };
          store.create = unexpected;
          store.update = unexpected;
          const res = await request(app, method, '/v1/groups' + (method === 'PUT' ? '/fixture' : ''), { ...INPUT, [field]: invalid });
          assert.equal(res.status, 400);
          const body = await res.json();
          assert.deepEqual(body, { error: 'The request is invalid.', code: 'VALIDATION_ERROR', field });
          assert.equal(JSON.stringify(body).includes(CANARY), false);
          assert.equal(calls, 0);
        });
      });
    }

    it(method + ': preserves root validation fallback', async () => {
      await fixture(async (app) => {
        const res = await request(app, method, '/v1/groups' + (method === 'PUT' ? '/fixture' : ''), null);
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error: 'The request is invalid.', code: 'VALIDATION_ERROR', field: '' });
      });
    });

    it(method + ': preserves malformed JSON 500 without parser details', async () => {
      await fixture(async (app) => {
        const res = await app.request('/v1/groups' + (method === 'PUT' ? '/fixture' : ''),
          { method, headers: { 'Content-Type': 'application/json' }, body: '{' + CANARY });
        assert.equal(res.status, 500);
        assert.deepEqual(await res.json(), { error: SAFE });
      });
    });
  }

  for (const method of ['PUT', 'DELETE']) {
    it(method + ': preserves genuine missing-group 404 and existing data', async () => {
      await fixture(async (app, store) => {
        const existing = store.create(INPUT);
        const res = await request(app, method, '/v1/groups/' + CANARY, method === 'PUT' ? {} : undefined);
        assert.equal(res.status, 404);
        assert.deepEqual(await res.json(), { error: 'The requested resource was not found.', code: 'NOT_FOUND' });
        assert.deepEqual(store.list(), [existing]);
      });
    });
  }

  it('preserves real CRUD, intentional weight keys, optional fields and stripped unknown keys', async () => {
    await fixture(async (app, store) => {
      const input = { ...INPUT, modelPattern: 'fixture-*', stickyTTL: 30, weights: { [CANARY]: 2 },
        members: [{ provider: 'fixture', keyName: 'key-label', weight: 2, priority: 1 }] };
      const created = await request(app, 'POST', '/v1/groups', { ...input, unknown: 'discard' });
      assert.equal(created.status, 201);
      const group = await created.json();
      assert.deepEqual(group, { id: 'fixture-group', ...input });
      assert.deepEqual(store.get(group.id), group);
      const listed = await request(app, 'GET', '/v1/groups');
      assert.equal(listed.status, 200);
      assert.deepEqual(await listed.json(), { groups: [group] });
      const unchanged = await request(app, 'PUT', '/v1/groups/' + group.id, {});
      assert.equal(unchanged.status, 200);
      assert.deepEqual(await unchanged.json(), group);
      const changed = await request(app, 'PUT', '/v1/groups/' + group.id, { name: 'Renamed', unknown: 'discard' });
      assert.equal(changed.status, 200);
      assert.deepEqual(await changed.json(), { ...group, name: 'Renamed' });
      assert.deepEqual(store.get(group.id), { ...group, name: 'Renamed' });
      const removed = await request(app, 'DELETE', '/v1/groups/' + group.id);
      assert.equal(removed.status, 200);
      assert.deepEqual(await removed.json(), { ok: true });
      assert.equal(store.get(group.id), null);
      assert.deepEqual(await (await request(app, 'GET', '/v1/groups')).json(), { groups: [] });
    });
  });

  it('requires create strategy rather than applying the SQL default', async () => {
    await fixture(async (app, store) => {
      const res = await request(app, 'POST', '/v1/groups', { name: 'Missing strategy', members: INPUT.members });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: 'The request is invalid.', code: 'VALIDATION_ERROR', field: 'strategy' });
      assert.deepEqual(store.list(), []);
    });
  });

  it('does not register any group routes without a store', async () => {
    const app = new Hono();
    registerGroupRoutes(app, {});
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const path = '/v1/groups' + (method === 'PUT' || method === 'DELETE' ? '/fixture' : '');
      assert.equal((await request(app, method, path)).status, 404);
    }
  });
});
