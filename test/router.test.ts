/**
 * Router tests — provider selection, fallback, and model aggregation.
 *
 * Uses mock providers implementing the LLMProvider interface.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Router } from '../src/core/router.js';
import type {
  LLMProvider,
  GenerateRequest,
  GenerateResponse,
  ModelInfo,
  ProviderType,
} from '../src/core/types.js';

/** Create a mock provider for testing. */
function createMockProvider(opts: {
  id: string;
  name: string;
  type: ProviderType;
  models: ModelInfo[];
  available?: boolean;
  response?: GenerateResponse;
  shouldFail?: boolean;
  failMessage?: string;
}): LLMProvider {
  return {
    id: opts.id,
    name: opts.name,
    type: opts.type,
    models: opts.models,

    async generate(_request: GenerateRequest): Promise<GenerateResponse> {
      if (opts.shouldFail) {
        throw new Error(opts.failMessage ?? `${opts.id} failed`);
      }
      return opts.response ?? {
        text: `Response from ${opts.id}`,
        provider: opts.id,
        model: opts.models[0]?.id ?? 'unknown',
      };
    },

    async isAvailable(): Promise<boolean> {
      return opts.available ?? true;
    },
  };
}

// ── Registration ──────────────────────────────────────────

describe('Router registration', () => {
  it('register() adds providers', async () => {
    const router = new Router();
    const provider = createMockProvider({
      id: 'test',
      name: 'Test',
      type: 'api',
      models: [{ id: 'test-model', name: 'Test Model', provider: 'test', maxTokens: 4096 }],
    });

    router.register(provider);

    const models = await router.getAvailableModels();
    assert.equal(models.length, 1);
    assert.equal(models[0]?.id, 'test-model');
  });
});

// ── Generation routing ────────────────────────────────────

describe('Router.generate()', () => {
  it('returns response from first available provider', async () => {
    const router = new Router();
    router.register(createMockProvider({
      id: 'first',
      name: 'First',
      type: 'api',
      models: [{ id: 'model-a', name: 'Model A', provider: 'first', maxTokens: 4096 }],
      response: { text: 'from-first', provider: 'first', model: 'model-a' },
    }));
    router.register(createMockProvider({
      id: 'second',
      name: 'Second',
      type: 'api',
      models: [{ id: 'model-b', name: 'Model B', provider: 'second', maxTokens: 4096 }],
      response: { text: 'from-second', provider: 'second', model: 'model-b' },
    }));

    const result = await router.generate({ prompt: 'test' });
    assert.equal(result.text, 'from-first');
    assert.equal(result.provider, 'first');
  });

  it('routes to correct provider when model param is specified', async () => {
    const router = new Router();
    router.register(createMockProvider({
      id: 'provider-a',
      name: 'Provider A',
      type: 'api',
      models: [{ id: 'model-a', name: 'Model A', provider: 'provider-a', maxTokens: 4096 }],
      response: { text: 'from-a', provider: 'provider-a', model: 'model-a' },
    }));
    router.register(createMockProvider({
      id: 'provider-b',
      name: 'Provider B',
      type: 'api',
      models: [{ id: 'model-b', name: 'Model B', provider: 'provider-b', maxTokens: 4096 }],
      response: { text: 'from-b', provider: 'provider-b', model: 'model-b' },
    }));

    const result = await router.generate({ prompt: 'test', model: 'model-b' });
    assert.equal(result.text, 'from-b');
    assert.equal(result.provider, 'provider-b');
  });

  it('routes to correct provider when provider param is specified', async () => {
    const router = new Router();
    router.register(createMockProvider({
      id: 'alpha',
      name: 'Alpha',
      type: 'api',
      models: [{ id: 'alpha-model', name: 'Alpha Model', provider: 'alpha', maxTokens: 4096 }],
      response: { text: 'from-alpha', provider: 'alpha', model: 'alpha-model' },
    }));
    router.register(createMockProvider({
      id: 'beta',
      name: 'Beta',
      type: 'api',
      models: [{ id: 'beta-model', name: 'Beta Model', provider: 'beta', maxTokens: 4096 }],
      response: { text: 'from-beta', provider: 'beta', model: 'beta-model' },
    }));

    const result = await router.generate({ prompt: 'test', provider: 'beta' });
    assert.equal(result.text, 'from-beta');
    assert.equal(result.provider, 'beta');
  });

  it('falls back to second provider if first fails', async () => {
    const router = new Router();
    router.register(createMockProvider({
      id: 'failing',
      name: 'Failing',
      type: 'api',
      models: [{ id: 'fail-model', name: 'Fail Model', provider: 'failing', maxTokens: 4096 }],
      shouldFail: true,
      failMessage: 'API rate limit exceeded',
    }));
    router.register(createMockProvider({
      id: 'backup',
      name: 'Backup',
      type: 'api',
      models: [{ id: 'backup-model', name: 'Backup Model', provider: 'backup', maxTokens: 4096 }],
      response: { text: 'from-backup', provider: 'backup', model: 'backup-model' },
    }));

    const result = await router.generate({ prompt: 'test' });
    assert.equal(result.text, 'from-backup');
    assert.equal(result.provider, 'backup');
  });

  it('throws when all providers fail', async () => {
    const router = new Router();
    router.register(createMockProvider({
      id: 'fail-1',
      name: 'Fail 1',
      type: 'api',
      models: [{ id: 'f1', name: 'F1', provider: 'fail-1', maxTokens: 4096 }],
      shouldFail: true,
    }));
    router.register(createMockProvider({
      id: 'fail-2',
      name: 'Fail 2',
      type: 'api',
      models: [{ id: 'f2', name: 'F2', provider: 'fail-2', maxTokens: 4096 }],
      shouldFail: true,
    }));

    await assert.rejects(
      () => router.generate({ prompt: 'test' }),
      /All providers failed/,
    );
  });

  it('throws when no providers are available', async () => {
    const router = new Router();
    router.register(createMockProvider({
      id: 'unavailable',
      name: 'Unavailable',
      type: 'api',
      models: [{ id: 'u1', name: 'U1', provider: 'unavailable', maxTokens: 4096 }],
      available: false,
    }));

    await assert.rejects(
      () => router.generate({ prompt: 'test' }),
      /No providers available/,
    );
  });
});

// ── Model aggregation ─────────────────────────────────────

describe('Router.getAvailableModels()', () => {
  it('aggregates models from available providers', async () => {
    const router = new Router();
    router.register(createMockProvider({
      id: 'p1',
      name: 'P1',
      type: 'api',
      models: [
        { id: 'm1', name: 'M1', provider: 'p1', maxTokens: 4096 },
        { id: 'm2', name: 'M2', provider: 'p1', maxTokens: 8192 },
      ],
    }));
    router.register(createMockProvider({
      id: 'p2',
      name: 'P2',
      type: 'cli',
      models: [{ id: 'm3', name: 'M3', provider: 'p2', maxTokens: 4096 }],
    }));
    router.register(createMockProvider({
      id: 'p3',
      name: 'P3',
      type: 'api',
      models: [{ id: 'm4', name: 'M4', provider: 'p3', maxTokens: 4096 }],
      available: false,
    }));

    const models = await router.getAvailableModels();
    assert.equal(models.length, 3, 'Should only include models from available providers');
    const ids = models.map(m => m.id);
    assert.ok(ids.includes('m1'));
    assert.ok(ids.includes('m2'));
    assert.ok(ids.includes('m3'));
    assert.ok(!ids.includes('m4'), 'Should not include models from unavailable providers');
  });
});

// ── Provider ordering ─────────────────────────────────────

describe('Router provider ordering', () => {
  it('API providers sort before CLI providers in default order', async () => {
    const router = new Router();

    // Register CLI first, then API
    router.register(createMockProvider({
      id: 'cli-first',
      name: 'CLI First',
      type: 'cli',
      models: [{ id: 'cli-m', name: 'CLI M', provider: 'cli-first', maxTokens: 4096 }],
      response: { text: 'from-cli', provider: 'cli-first', model: 'cli-m' },
    }));
    router.register(createMockProvider({
      id: 'api-second',
      name: 'API Second',
      type: 'api',
      models: [{ id: 'api-m', name: 'API M', provider: 'api-second', maxTokens: 4096 }],
      response: { text: 'from-api', provider: 'api-second', model: 'api-m' },
    }));

    // Without specifying provider/model, API should be tried first
    const result = await router.generate({ prompt: 'test' });
    assert.equal(result.provider, 'api-second', 'API provider should be tried before CLI');
  });
});
