/**
 * Router setter tests — verify setters and getters for new modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Router } from '../src/core/router.js';
import type { LocalLLMClient } from '../src/core/router.js';
import { ModelRouter } from '../src/model-routing/router.js';
import { ApprovalStore } from '../src/approval/index.js';
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

  it('setLocalLLMClient stores and retrieves LocalLLMClient', () => {
    const router = new Router();
    const localClient: LocalLLMClient = {
      generate: async () => ({
        text: 'hello',
        provider: 'local',
        model: 'llama3.2:3b',
        resolvedProvider: 'local',
        resolvedModel: 'llama3.2:3b',
        fallbackUsed: false,
      }),
    };

    assert.equal(router.localLLMClient, null);

    router.setLocalLLMClient(localClient);
    assert.equal(router.localLLMClient, localClient);
    assert.ok(router.localLLMClient !== null);
  });

  it('setApprovalStore stores and retrieves ApprovalStore', () => {
    const router = new Router();
    const approvalStore = new ApprovalStore();

    assert.equal(router.approvalStore, null);

    router.setApprovalStore(approvalStore);
    assert.equal(router.approvalStore, approvalStore);
    assert.ok(router.approvalStore !== null);
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

  it('all four setters can be set on the same router instance', () => {
    const router = new Router();
    const modelRouter = new ModelRouter({ enabled: true, endpoints: [], rules: [], defaultEndpoint: '', qualityThreshold: 0.7, qualityWindowSize: 50 });
    const localClient: LocalLLMClient = {
      generate: async () => ({
        text: 'hello',
        provider: 'local',
        model: 'llama3.2:3b',
        resolvedProvider: 'local',
        resolvedModel: 'llama3.2:3b',
        fallbackUsed: false,
      }),
    };
    const approvalStore = new ApprovalStore();
    const sessionManager = new SessionManager();

    router.setModelRouter(modelRouter);
    router.setLocalLLMClient(localClient);
    router.setApprovalStore(approvalStore);
    router.setSessionManager(sessionManager);

    assert.equal(router.modelRouter, modelRouter);
    assert.equal(router.localLLMClient, localClient);
    assert.equal(router.approvalStore, approvalStore);
    assert.equal(router.sessionManager, sessionManager);

    sessionManager.stopCleanup();
  });
});
