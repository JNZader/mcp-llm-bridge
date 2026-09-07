import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { Hono } from 'hono';
import { createLogger, logger } from '../../src/core/logger.js';
import { ProfileEnforcer, securityProfileMiddleware } from '../../src/security/enforcer.js';

const CANARY = 'private-security-log-canary';
const FILTER_MESSAGE = 'Tool not found in TOOL_CATEGORIES — blocked by default';
const DENY_MESSAGE = 'Tool call denied by security profile';
const ROUTE_MESSAGE = 'Route not found in ROUTE_CATEGORIES — blocked by default';

async function capture(t: TestContext, run: (lines: string[]) => void | Promise<void>) {
  const lines: string[] = [];
  const output = createLogger({ pretty: false, level: 'warn' }, {
    write(line: string) { lines.push(line); },
  });
  // Route warnings through real Pino serialization, not an argument-only spy.
  const warning = t.mock.method(logger, 'warn', output.warn.bind(output));
  t.mock.timers.enable({ apis: ['setInterval'] });
  try { await run(lines); }
  finally {
    warning.mock.restore();
    t.mock.timers.reset();
  }
}

function event(lines: string[], message: string, metadata: Record<string, string>) {
  assert.equal(lines.length, 1);
  assert.equal(lines.join('').includes(CANARY), false);
  const entry: Record<string, unknown> = JSON.parse(lines[0]!);
  // Pino's process metadata is not application event payload.
  const { pid, hostname, time, ...application } = entry;
  assert.equal(typeof pid, 'number');
  assert.equal(typeof hostname, 'string');
  assert.equal(typeof time, 'number');
  assert.deepEqual(application, {
    level: 40, msg: message, outcome: 'denied', code: 'ACCESS_DENIED', ...metadata,
  });
  assert.equal('tool' in entry, false);
  assert.equal('path' in entry, false);
}

describe('LOG-OPERATIONS security serialized warnings', { concurrency: false }, () => {
  it('filters unknown tools without emitting their names or changing retained definitions', async (t) => {
    await capture(t, (lines) => {
      const enforcer = new ProfileEnforcer('restricted');
      try {
        const allowed = { name: 'llm_models', description: CANARY, inputSchema: {} };
        const unknown = { ...allowed, name: CANARY };
        assert.deepEqual(enforcer.filterTools([unknown, allowed]), [allowed]);
        event(lines, FILTER_MESSAGE, { profile: 'restricted' });
      } finally { enforcer.destroy(); }
    });
  });

  it('omits missing categories rather than inventing an unknown category', async (t) => {
    await capture(t, (lines) => {
      const enforcer = new ProfileEnforcer('open');
      try {
        assert.equal(enforcer.authorize(CANARY), false);
        event(lines, DENY_MESSAGE, { profile: 'open' });
      } finally { enforcer.destroy(); }
    });
  });

  it('retains a finite category but not a dynamic tool name', async (t) => {
    await capture(t, (lines) => {
      const enforcer = new ProfileEnforcer('restricted');
      try {
        enforcer.registerDynamicTool(CANARY, 'destructive');
        assert.equal(enforcer.authorize(CANARY), false);
        event(lines, DENY_MESSAGE, { profile: 'restricted', category: 'destructive' });
      } finally { enforcer.destroy(); }
    });
  });

  it('defensively omits unrecognized runtime category and profile values', async (t) => {
    await capture(t, (lines) => {
      const enforcer = new ProfileEnforcer('restricted');
      try {
        // Defensive in-process mutation, not a claim of a JSON schema exploit.
        const security = { category: 'destructive' as const };
        Reflect.defineProperty(security, 'category', { value: CANARY });
        enforcer.registerDynamicTool(CANARY, security);
        const profile = { ...enforcer.profile };
        Reflect.defineProperty(profile, 'level', { value: CANARY });
        Reflect.defineProperty(enforcer, 'profile', { value: profile });
        assert.equal(enforcer.authorize(CANARY), false);
        event(lines, DENY_MESSAGE, {});
      } finally { enforcer.destroy(); }
    });
  });

  for (const method of ['GET', 'PATCH', CANARY]) {
    it('contains unknown-route warnings for method ' + method, async (t) => {
      await capture(t, async (lines) => {
        const app = new Hono();
        let delegated = 0;
        app.use('*', securityProfileMiddleware('restricted'));
        app.all('*', (c) => { delegated++; return c.text('unexpected'); });
        const response = await app.request('/v1/' + CANARY + '?secret=' + CANARY, { method });
        assert.equal(response.status, 403);
        assert.equal(delegated, 0);
        assert.deepEqual(await response.json(), {
          error: 'Access denied: endpoint blocked by security profile',
          code: 'SECURITY_PROFILE_DENIED', profile: 'restricted',
        });
        event(lines, ROUTE_MESSAGE, method === CANARY
          ? { profile: 'restricted' } : { profile: 'restricted', method });
      });
    });
  }

  it('keeps allowed tools, authorization and the ten-call quota unchanged without warnings', async (t) => {
    await capture(t, (lines) => {
      const enforcer = new ProfileEnforcer('open');
      try {
        const tool = { name: 'llm_models', description: CANARY, inputSchema: {} };
        assert.deepEqual(enforcer.filterTools([tool]), [tool]);
        assert.equal(enforcer.authorize(tool.name), true);
        for (let i = 0; i < 10; i++) assert.equal(enforcer.checkRate().allowed, true);
        assert.equal(enforcer.checkRate().allowed, false);
        assert.deepEqual(lines, []);
      } finally { enforcer.destroy(); }
    });
  });

  it('delegates allowed HTTP requests without new warning events', async (t) => {
    await capture(t, async (lines) => {
      const app = new Hono();
      let delegated = 0;
      app.use('*', securityProfileMiddleware('restricted'));
      app.all('*', (c) => { delegated++; return c.json({ intentional: CANARY }, 202); });
      const response = await app.request('/v1/groups?secret=' + CANARY);
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { intentional: CANARY });
      assert.equal(delegated, 1);
      assert.deepEqual(lines, []);
    });
  });
});
