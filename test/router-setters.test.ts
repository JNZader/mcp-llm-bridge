/**
 * Router setter tests — verify live router dependencies.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Router } from '../src/core/router.js';
import { ModelRouter } from '../src/model-routing/router.js';
import { SessionManager } from '../src/session/session-manager.js';

describe('Router setters', () => {
  it('setModelRouter stores and retrieves ModelRouter', () => {
    const router = new Router();
    const modelRouter = new ModelRouter({ enabled: true, endpoints: [], rules: [], defaultEndpoint: '', qualityThreshold: 0.7, qualityWindowSize: 50 });

    assert.equal(router.modelRouter, null);

    router.setModelRouter(modelRouter);
    assert.equal(router.modelRouter, modelRouter);
    assert.ok(router.modelRouter !== null);
  });

  it('setSessionManager stores and retrieves SessionManager', () => {
    const router = new Router();
    const sessionManager = new SessionManager();

    assert.equal(router.sessionManager, null);

    router.setSessionManager(sessionManager);
    assert.equal(router.sessionManager, sessionManager);
    assert.ok(router.sessionManager !== null);

    sessionManager.stopCleanup();
  });

  it('live setters can be set on the same router instance', () => {
    const router = new Router();
    const modelRouter = new ModelRouter({ enabled: true, endpoints: [], rules: [], defaultEndpoint: '', qualityThreshold: 0.7, qualityWindowSize: 50 });
    const sessionManager = new SessionManager();

    router.setModelRouter(modelRouter);
    router.setSessionManager(sessionManager);

    assert.equal(router.modelRouter, modelRouter);
    assert.equal(router.sessionManager, sessionManager);

    sessionManager.stopCleanup();
  });
});
