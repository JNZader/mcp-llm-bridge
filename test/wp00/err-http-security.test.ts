import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { Hono } from 'hono';
import type { TrustLevel } from '../../src/core/types.js';
import { securityProfileMiddleware } from '../../src/security/enforcer.js';

const CANARY = 'private-http-security-canary';
const SUCCESS = { intentional: 'Downstream response', nested: { retained: true } };

interface RouteCase {
  profile: TrustLevel;
  method: string;
  path: string;
}

async function fixture(
  t: TestContext,
  profile: TrustLevel | undefined,
  run: (app: Hono, delegated: string[]) => Promise<void>,
) {
  // The middleware hides its enforcer. Own its interval through test timers;
  // no real cleanup timer is started, and reset releases all mocked handles.
  t.mock.timers.enable({ apis: ['setInterval'] });
  try {
    const app = new Hono();
    const delegated: string[] = [];
    app.use('*', securityProfileMiddleware(profile));
    app.all('*', (c) => {
      delegated.push(c.req.method + ' ' + c.req.path);
      c.header('X-Downstream', 'retained');
      return c.json(SUCCESS, 202);
    });
    await run(app, delegated);
  } finally { t.mock.timers.reset(); }
}

// Characterization: current production behavior is expected to pass unchanged.
describe('HTTP security fixed-envelope characterization', { concurrency: false }, () => {
  const denied: RouteCase[] = [
    { profile: 'restricted', method: 'GET', path: '/v1/' + CANARY },
    { profile: 'open', method: 'GET', path: '/v1/providers' },
    { profile: 'restricted', method: 'POST', path: '/v1/credentials' },
    { profile: 'restricted', method: 'DELETE', path: '/v1/files' },
    { profile: 'restricted', method: 'PUT', path: '/v1/groups' },
    { profile: 'restricted', method: 'POST', path: '/v1/compare' },
    { profile: 'open', method: 'PUT', path: '/v1/circuit-breaker/config' },
    { profile: 'restricted', method: 'GET', path: '/authentication/' + CANARY },
    { profile: 'restricted', method: 'GET', path: '/v1/administer/' + CANARY },
  ];
  for (const route of denied) {
    it('contains ' + route.profile + ' denial for ' + route.method + ' ' + route.path, async (t) => {
      await fixture(t, route.profile, async (app, delegated) => {
        // Query claims cannot replace the deliberately configured profile.
        const res = await app.request(route.path + '?profile=local-dev&secret=' + CANARY, {
          method: route.method, headers: { 'X-Project': CANARY },
        });
        assert.equal(res.status, 403);
        assert.match(res.headers.get('content-type') ?? '', /application\/json/);
        const body = await res.json();
        assert.deepEqual(body, {
          error: 'Access denied: endpoint blocked by security profile',
          code: 'SECURITY_PROFILE_DENIED', profile: route.profile,
        });
        assert.equal(JSON.stringify(body).includes(CANARY), false);
        assert.equal(res.headers.has('X-Downstream'), false);
        assert.deepEqual(delegated, []);
      });
    });
  }

  const allowed: RouteCase[] = [
    { profile: 'restricted', method: 'GET', path: '/v1/credentials' },
    { profile: 'restricted', method: 'GET', path: '/v1/groups' },
    { profile: 'restricted', method: 'GET', path: '/v1/circuit-breaker/config' },
    { profile: 'open', method: 'POST', path: '/v1/generate' },
    // These skips belong to other authentication layers, not an auth grant.
    { profile: 'open', method: 'GET', path: '/health' },
    { profile: 'open', method: 'GET', path: '/auth/' + CANARY },
    { profile: 'open', method: 'POST', path: '/v1/admin/' + CANARY },
  ];
  for (const route of allowed) {
    it('delegates ' + route.method + ' ' + route.path + ' without changing the response', async (t) => {
      await fixture(t, route.profile, async (app, delegated) => {
        const res = await app.request(route.path + '?secret=' + CANARY, { method: route.method });
        assert.equal(res.status, 202);
        assert.equal(res.headers.get('X-Downstream'), 'retained');
        assert.deepEqual(await res.json(), SUCCESS);
        assert.deepEqual(delegated, [route.method + ' ' + route.path]);
      });
    });
  }

  for (const profile of [undefined, 'local-dev'] as const) {
    it('retains local-dev pass-through for ' + (profile ?? 'omitted profile'), async (t) => {
      await fixture(t, profile, async (app, delegated) => {
        const res = await app.request('/v1/' + CANARY, { method: 'DELETE' });
        assert.equal(res.status, 202);
        assert.deepEqual(await res.json(), SUCCESS);
        assert.deepEqual(delegated, ['DELETE /v1/' + CANARY]);
      });
    });
  }
});
