/**
 * Free Model Router tests — integration, config, availability.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FreeModelRouter } from '../../src/free-models/router.js';
import { BUILTIN_FREE_MODELS } from '../../src/free-models/registry.js';

// ── FreeModelRouter ──────────────────────────────────────

describe('FreeModelRouter', () => {
  it('is not available when disabled (default)', () => {
    const router = new FreeModelRouter({ enabled: false });
    assert.equal(router.isAvailable, false);
    router.destroy();
  });

  it('is available when enabled with models', () => {
    const router = new FreeModelRouter({ enabled: true });
    assert.equal(router.isAvailable, true);
    router.destroy();
  });

  it('exposes registry with built-in models', () => {
    const router = new FreeModelRouter({ enabled: false });
    const registry = router.getRegistry();
    assert.ok(registry.size >= BUILTIN_FREE_MODELS.length);
    router.destroy();
  });

  it('exposes health checker', () => {
    const router = new FreeModelRouter({ enabled: false });
    const checker = router.getHealthChecker();
    assert.ok(checker);
    assert.equal(checker.getAllHealth().size, 0);
    router.destroy();
  });

  it('accepts custom model config', () => {
    const router = new FreeModelRouter({
      enabled: false,
      models: [
        {
          id: 'custom-test',
          name: 'Custom Test',
          source: 'test',
          baseUrl: 'https://test.com/v1',
          modelId: 'test/model',
          capabilities: ['chat'],
          maxTokens: 4096,
          enabled: true,
        },
      ],
    });

    const registry = router.getRegistry();
    assert.ok(registry.get('custom-test'));
    router.destroy();
  });

  it('generate() throws when no models are available', async () => {
    const router = new FreeModelRouter({
      enabled: true,
      models: [
        {
          id: 'always-down',
          name: 'Down Model',
          source: 'test',
          baseUrl: 'https://nonexistent.invalid',
          modelId: 'test/down',
          capabilities: ['chat'],
          maxTokens: 4096,
          enabled: false, // No enabled models
        },
      ],
    });

    // Override built-ins by using models that are disabled
    // The router with only disabled models should have no available candidates
    await assert.rejects(
      () => router.generate({ prompt: 'hello' }),
      { message: /No free models available/ },
    );
    router.destroy();
  });

  it('destroy() cleans up without errors', () => {
    const router = new FreeModelRouter({ enabled: true });
    router.destroy();
    // Second destroy should be safe
    router.destroy();
  });
});
