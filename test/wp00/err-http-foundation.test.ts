import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';

import { apiKeyAuth } from '../../src/auth/middleware.js';
import { bearerAuth, bodySizeLimit, rateLimitMiddleware } from '../../src/server/http-app.js';
import { getValidationIssue, jsonChatInvalidRequestError, jsonGenerateValidationError } from '../../src/server/http-helpers/request-validation.js';

const CANARY = 'credential-canary-should-never-be-disclosed';

type Middleware = (context: never, next: never) => unknown;

function appFor(middleware: Middleware) {
  const app = new Hono();
  app.use('*', middleware as never);
  app.get('/protected', (c) => c.json({ ok: true }));
  app.post('/protected', (c) => c.json({ ok: true }));
  return app;
}

describe('ERR-HTTP-FOUNDATION', () => {
  it('SAFE-HF-01 and SAFE-HF-02 preserve API-key auth codes without reflecting malformed credentials', async () => {
    const app = new Hono();
    app.use('*', apiKeyAuth({} as never));
    app.get('/protected', (c) => c.json({ ok: true }));

    for (const [header, code] of [[undefined, 'MISSING_AUTH'], [`Basic ${CANARY}`, 'INVALID_AUTH_FORMAT']] as const) {
      const response = await app.request('/protected', { headers: header ? { Authorization: header } : undefined });
      const body = await response.json() as { code: string };
      assert.equal(response.status, 401);
      assert.equal(body.code, code);
      assert.equal(JSON.stringify(body).includes(CANARY), false);
    }
  });

  it('SAFE-HF-03 rejects static bearer failures without reflecting the supplied token', async () => {
    const app = appFor(bearerAuth({ authToken: 'expected-token' } as never) as never);
    const response = await app.request('/protected', { headers: { Authorization: `Bearer ${CANARY}` } });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.deepEqual(body, { error: 'Unauthorized' });
    assert.equal(JSON.stringify(body).includes(CANARY), false);
  });

  it('SAFE-HF-04 returns the stable payload-size code for an oversized declared body', async () => {
    const app = appFor(bodySizeLimit as never);
    const response = await app.request('/protected', {
      method: 'POST',
      headers: { 'content-length': '1000001' },
    });

    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' });
  });

  it('SAFE-HF-05 rejects malformed Content-Length without reflecting client data', async () => {
    const app = appFor(bodySizeLimit as never);
    const response = await app.request('/protected', {
      method: 'POST',
      headers: { 'content-length': `1000001${CANARY}` },
    });
    const body = await response.json() as { error: string; code: string };

    assert.equal(response.status, 400);
    assert.deepEqual(body, { error: 'The request is invalid.', code: 'VALIDATION_ERROR' });
    assert.equal(JSON.stringify(body).includes(CANARY), false);
  });

  it('SAFE-HF-06 returns bounded rate-limit metadata and no client-controlled header data', async () => {
    const limiter = {
      isRateLimited: () => true,
      getResetAt: () => Date.now() - 1,
      getRemaining: () => 0,
    };
    const app = appFor(rateLimitMiddleware(limiter as never) as never);
    const response = await app.request('/protected', { headers: { 'x-real-ip': CANARY } });

    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '0');
    assert.deepEqual(await response.json(), { error: 'Too many requests', code: 'RATE_LIMITED', retryAfter: 0 });
  });

  it('SAFE-HF-07 projects generate validation to a generic typed safe response', async () => {
    const app = new Hono();
    app.get('/generate', (c) => jsonGenerateValidationError(c, { message: CANARY, field: CANARY }));
    const response = await app.request('/generate');
    const body = await response.json() as { error: string; code: string; field: string };

    assert.equal(response.status, 400);
    assert.equal(body.code, 'VALIDATION_ERROR');
    assert.equal(body.error, 'The request is invalid.');
    assert.equal(body.field, '');
    assert.equal(JSON.stringify(body).includes(CANARY), false);
  });

  it('SAFE-HF-08 projects OpenAI validation parameters only when they are bounded metadata', async () => {
    const app = new Hono();
    app.get('/chat', (c) => jsonChatInvalidRequestError(c, CANARY, c.req.header('x-safe-param') ?? CANARY));
    const response = await app.request('/chat');
    const body = await response.json() as { error: { message: string; type: string; param?: string; code: null } };

    assert.equal(response.status, 400);
    assert.deepEqual(body.error, {
      message: 'The request is invalid.',
      type: 'invalid_request_error',
      code: null,
    });
    assert.equal(JSON.stringify(body).includes(CANARY), false);
    const safeResponse = await app.request('/chat', { headers: { 'x-safe-param': 'messages' } });
    assert.equal((await safeResponse.json() as { error: { param?: string } }).error.param, 'messages');
    assert.deepEqual(getValidationIssue({ issues: [{ message: CANARY, path: ['messages', 0, 'content'] }] }), {
      message: 'The request is invalid.',
      field: 'messages.0.content',
    });
  });
});
