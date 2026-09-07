import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { ApprovalStore } from '../../src/approval/index.js';
import { registerApprovalRoutes } from '../../src/server/routes/approvals.js';

const CANARY = 'private-approval-error-canary';
const SAFE = 'An unexpected internal error occurred.';
const routes = [
  { method: 'GET', path: '/v1/approvals', operation: 'getPending' },
  { method: 'POST', path: '/v1/approvals/fixture/approve', operation: 'approve' },
  { method: 'POST', path: '/v1/approvals/fixture/deny', operation: 'deny' },
] as const;

function appFor(store?: ApprovalStore) {
  const app = new Hono();
  app.onError(() => new Response('Unexpected framework fallback', { status: 599 }));
  registerApprovalRoutes(app, { approvalStore: store });
  return app;
}

function createPending(store: ApprovalStore) {
  return store.create({ toolName: 'fixture-tool', toolArgs: { intended: CANARY },
    requester: 'fixture-requester', reason: 'Fixture approval request' });
}

describe('Approval HTTP failure containment', () => {
  for (const route of routes) {
    for (const kind of ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked']) {
      it(route.operation + ': contains ' + kind + ' without inspecting the thrown value', async () => {
        const store = new ApprovalStore();
        const pending = createPending(store);
        let accesses = 0;
        const inspect = () => { accesses++; throw new Error(CANARY); };
        let value: unknown = new Error(CANARY);
        if (kind === 'string') value = CANARY;
        if (kind === 'getter') value = Object.defineProperty(new Error(), 'message', { get: inspect });
        if (kind === 'coercion') value = { [Symbol.toPrimitive]: inspect, toString: inspect };
        if (kind === 'proxy') value = new Proxy({}, { get: inspect, getPrototypeOf: inspect });
        if (kind === 'revoked') {
          const revocable = Proxy.revocable({}, {});
          revocable.revoke();
          value = revocable.proxy;
        }
        const original = store[route.operation];
        let calls = 0;
        try {
          store[route.operation] = () => { calls++; throw value; };
          const res = await appFor(store).request(route.path, { method: route.method });
          assert.equal(res.status, 500);
          assert.equal(calls, 1);
          assert.equal(accesses, 0);
          assert.deepEqual(await res.json(), { error: SAFE });
          assert.equal(store.get(pending.id)?.status, 'pending');
        } finally {
          Object.defineProperty(store, route.operation, { configurable: true, writable: true, value: original });
        }
      });
    }

    it(route.operation + ': remains unregistered without a store', async () => {
      const res = await appFor().request(route.path, { method: route.method });
      assert.equal(res.status, 404);
      assert.equal(await res.text(), '404 Not Found');
    });
  }

  it('lists only pending requests without redacting intentional tool arguments', async () => {
    const store = new ApprovalStore();
    const first = createPending(store);
    const resolved = createPending(store);
    store.approve(resolved.id, 'operator');
    const last = createPending(store);
    const res = await appFor(store).request('/v1/approvals');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { requests: [first, last], count: 2 });
    assert.deepEqual(first.toolArgs, { intended: CANARY });
  });

  for (const action of ['approve', 'deny'] as const) {
    for (const user of [undefined, 'fixture-operator']) {
      it(action + ': preserves real lifecycle, resolver and ignored malformed body for ' + (user ?? 'default'), async () => {
        const store = new ApprovalStore();
        const pending = createPending(store);
        const before = { ...pending };
        const app = appFor(store);
        const path = '/v1/approvals/' + pending.id + '/' + action;
        const res = await app.request(path, { method: 'POST', body: '{malformed',
          headers: { 'content-type': 'application/json', ...(user ? { 'X-User-Id': user } : {}) } });
        assert.equal(res.status, 200);
        const current = store.get(pending.id);
        assert.ok(current);
        assert.equal(current.status, action === 'approve' ? 'approved' : 'denied');
        assert.equal(current.resolvedBy, user ?? 'admin');
        assert.ok(current.resolvedAt);
        assert.deepEqual(await res.json(), { ...before, status: current.status,
          resolvedBy: user ?? 'admin', resolvedAt: current.resolvedAt });
        assert.deepEqual(store.getPending(), []);
        const snapshot = { ...current };
        const repeated = await app.request(path, { method: 'POST' });
        assert.equal(repeated.status, 404);
        assert.deepEqual(await repeated.json(), {
          error: 'Approval request not found or already resolved', code: 'NOT_FOUND',
        });
        assert.deepEqual(store.get(pending.id), snapshot);
      });
    }

    it(action + ': preserves fixed missing-request 404 without reflecting its ID', async () => {
      const store = new ApprovalStore();
      const res = await appFor(store).request('/v1/approvals/' + CANARY + '/' + action, { method: 'POST' });
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), {
        error: 'Approval request not found or already resolved', code: 'NOT_FOUND',
      });
      assert.deepEqual(store.getPending(), []);
    });
  }
});
