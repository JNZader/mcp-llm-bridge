/**
 * HTTP security middleware tests — verify ProfileEnforcer works for HTTP routes.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { securityProfileMiddleware } from '../../src/security/enforcer.js';
import { ROUTE_CATEGORIES } from '../../src/security/http-categories.js';

describe('ROUTE_CATEGORIES', () => {
  it('has generate routes', () => {
    assert.ok(ROUTE_CATEGORIES['/v1/generate'] === 'generate');
    assert.ok(ROUTE_CATEGORIES['/v1/chat/completions'] === 'generate');
    assert.ok(ROUTE_CATEGORIES['/v1/models'] === 'generate');
  });

  it('has read routes', () => {
    assert.ok(ROUTE_CATEGORIES['/v1/providers'] === 'read');
    assert.ok(ROUTE_CATEGORIES['/v1/latency'] === 'read');
    assert.ok(ROUTE_CATEGORIES['/v1/approvals'] === 'read');
  });

  it('has destructive routes with method prefix', () => {
    assert.ok(ROUTE_CATEGORIES['POST /v1/credentials'] === 'destructive');
    assert.ok(ROUTE_CATEGORIES['DELETE /v1/credentials'] === 'destructive');
    assert.ok(ROUTE_CATEGORIES['POST /v1/compare'] === 'destructive');
  });
});

describe('securityProfileMiddleware', () => {
  let app: Hono;

  afterEach(() => {
    // Clean up by creating fresh app for each test
  });

  it('local-dev allows all routes', async () => {
    app = new Hono();
    app.use('*', securityProfileMiddleware('local-dev'));
    app.post('/v1/credentials', (c) => c.json({ ok: true }));

    const req = new Request('http://localhost/v1/credentials', { method: 'POST' });
    const res = await app.fetch(req);
    assert.equal(res.status, 200);
  });

  it('restricted allows generate routes', async () => {
    app = new Hono();
    app.use('*', securityProfileMiddleware('restricted'));
    app.post('/v1/generate', (c) => c.json({ ok: true }));

    const req = new Request('http://localhost/v1/generate', { method: 'POST' });
    const res = await app.fetch(req);
    assert.equal(res.status, 200);
  });

  it('restricted blocks destructive routes with 403', async () => {
    app = new Hono();
    app.use('*', securityProfileMiddleware('restricted'));
    app.post('/v1/credentials', (c) => c.json({ ok: true }));

    const req = new Request('http://localhost/v1/credentials', { method: 'POST' });
    const res = await app.fetch(req);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'SECURITY_PROFILE_DENIED');
    assert.ok(body.profile);
  });

  it('restricted allows read routes', async () => {
    app = new Hono();
    app.use('*', securityProfileMiddleware('restricted'));
    app.get('/v1/providers', (c) => c.json({ ok: true }));

    const req = new Request('http://localhost/v1/providers', { method: 'GET' });
    const res = await app.fetch(req);
    assert.equal(res.status, 200);
  });

  it('open blocks read routes with 403', async () => {
    app = new Hono();
    app.use('*', securityProfileMiddleware('open'));
    app.get('/v1/providers', (c) => c.json({ ok: true }));

    const req = new Request('http://localhost/v1/providers', { method: 'GET' });
    const res = await app.fetch(req);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'SECURITY_PROFILE_DENIED');
  });

  it('open allows generate routes', async () => {
    app = new Hono();
    app.use('*', securityProfileMiddleware('open'));
    app.post('/v1/generate', (c) => c.json({ ok: true }));

    const req = new Request('http://localhost/v1/generate', { method: 'POST' });
    const res = await app.fetch(req);
    assert.equal(res.status, 200);
  });

  it('unknown routes are blocked by default', async () => {
    app = new Hono();
    app.use('*', securityProfileMiddleware('restricted'));
    app.get('/v1/unknown-route', (c) => c.json({ ok: true }));

    const req = new Request('http://localhost/v1/unknown-route', { method: 'GET' });
    const res = await app.fetch(req);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'SECURITY_PROFILE_DENIED');
  });

  it('defaults to local-dev when no profile provided', async () => {
    app = new Hono();
    app.use('*', securityProfileMiddleware());
    app.post('/v1/credentials', (c) => c.json({ ok: true }));

    const req = new Request('http://localhost/v1/credentials', { method: 'POST' });
    const res = await app.fetch(req);
    assert.equal(res.status, 200);
  });
});
