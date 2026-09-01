/**
 * Router tests — provider selection, fallback, and model aggregation.
 *
 * Uses mock providers implementing the LLMProvider interface.
 */

import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { getCircuitBreakerV2, resetCircuitBreakerV2, Router } from '../src/core/router.js';
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
        resolvedProvider: opts.id,
        resolvedModel: opts.models[0]?.id ?? 'unknown',
        fallbackUsed: false,
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
  beforeEach(() => {
    resetCircuitBreakerV2();
  });

  it('returns response from first available provider', async () => {
    const router = new Router();
    router.register(createMockProvider({
      id: 'first',
      name: 'First',
      type: 'api',
      models: [{ id: 'model-a', name: 'Model A', provider: 'first', maxTokens: 4096 }],
      response: { text: 'from-first', provider: 'first', model: 'model-a', resolvedProvider: 'first', resolvedModel: 'model-a', fallbackUsed: false },
    }));
    router.register(createMockProvider({
      id: 'second',
      name: 'Second',
      type: 'api',
      models: [{ id: 'model-b', name: 'Model B', provider: 'second', maxTokens: 4096 }],
      response: { text: 'from-second', provider: 'second', model: 'model-b', resolvedProvider: 'second', resolvedModel: 'model-b', fallbackUsed: false },
    }));

    const result = await router.generate({ prompt: 'test' });
    assert.equal(result.text, 'from-first');
    assert.equal(result.provider, 'first');
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.resolvedProvider, 'first');
    assert.equal(result.resolvedModel, 'model-a');
    assert.equal(result.requestedProvider, undefined);
    assert.equal(result.requestedModel, undefined);
  });

  it('routes to correct provider when model param is specified', async () => {
    const router = new Router();
    router.register(createMockProvider({
      id: 'provider-a',
      name: 'Provider A',
      type: 'api',
      models: [{ id: 'model-a', name: 'Model A', provider: 'provider-a', maxTokens: 4096 }],
      response: { text: 'from-a', provider: 'provider-a', model: 'model-a', resolvedProvider: 'provider-a', resolvedModel: 'model-a', fallbackUsed: false },
    }));
    router.register(createMockProvider({
      id: 'provider-b',
      name: 'Provider B',
      type: 'api',
      models: [{ id: 'model-b', name: 'Model B', provider: 'provider-b', maxTokens: 4096 }],
      response: { text: 'from-b', provider: 'provider-b', model: 'model-b', resolvedProvider: 'provider-b', resolvedModel: 'model-b', fallbackUsed: false },
    }));

    const result = await router.generate({ prompt: 'test', model: 'model-b' });
    assert.equal(result.text, 'from-b');
    assert.equal(result.provider, 'provider-b');
    assert.equal(result.requestedModel, 'model-b');
    assert.equal(result.resolvedProvider, 'provider-b');
    assert.equal(result.fallbackUsed, false);
  });

  it('routes to correct provider when provider param is specified', async () => {
    const router = new Router();
    router.register(createMockProvider({
      id: 'alpha',
      name: 'Alpha',
      type: 'api',
      models: [{ id: 'alpha-model', name: 'Alpha Model', provider: 'alpha', maxTokens: 4096 }],
      response: { text: 'from-alpha', provider: 'alpha', model: 'alpha-model', resolvedProvider: 'alpha', resolvedModel: 'alpha-model', fallbackUsed: false },
    }));
    router.register(createMockProvider({
      id: 'beta',
      name: 'Beta',
      type: 'api',
      models: [{ id: 'beta-model', name: 'Beta Model', provider: 'beta', maxTokens: 4096 }],
      response: { text: 'from-beta', provider: 'beta', model: 'beta-model', resolvedProvider: 'beta', resolvedModel: 'beta-model', fallbackUsed: false },
    }));

    const result = await router.generate({ prompt: 'test', provider: 'beta' });
    assert.equal(result.text, 'from-beta');
    assert.equal(result.provider, 'beta');
    assert.equal(result.requestedProvider, 'beta');
    assert.equal(result.resolvedProvider, 'beta');
    assert.equal(result.fallbackUsed, false);
  });

  it('normalizes opencode provider alias to opencode-cli', async () => {
    const router = new Router();
    let capturedRequest: GenerateRequest | undefined;

    router.register({
      ...createMockProvider({
        id: 'opencode-cli',
        name: 'OpenCode CLI',
        type: 'cli',
        models: [{ id: 'opencode-model', name: 'OpenCode Model', provider: 'opencode-cli', maxTokens: 4096 }],
      }),
      async generate(request: GenerateRequest): Promise<GenerateResponse> {
        capturedRequest = request;
        return {
          text: 'from-opencode',
          provider: 'opencode-cli',
          model: 'opencode-model',
          resolvedProvider: 'opencode-cli',
          resolvedModel: 'opencode-model',
          fallbackUsed: false,
        };
      },
    });

    const result = await router.generate({ prompt: 'test', provider: 'opencode' });

    assert.equal(result.provider, 'opencode-cli');
    assert.equal(result.requestedProvider, 'opencode-cli');
    assert.equal(capturedRequest?.provider, 'opencode-cli');
    assert.deepEqual(result.routing?.attemptedProviders, ['opencode-cli']);
  });

  it('keeps an explicit provider authoritative when the model belongs to another provider', async () => {
    const router = new Router();
    let alphaRequest: GenerateRequest | undefined;

    router.register({
      ...createMockProvider({
        id: 'alpha',
        name: 'Alpha',
        type: 'api',
        models: [{ id: 'alpha-model', name: 'Alpha Model', provider: 'alpha', maxTokens: 4096 }],
        response: {
          text: 'from-alpha',
          provider: 'alpha',
          model: 'beta-model',
          resolvedProvider: 'alpha',
          resolvedModel: 'beta-model',
          fallbackUsed: false,
        },
      }),
      async generate(request: GenerateRequest): Promise<GenerateResponse> {
        alphaRequest = request;
        return {
          text: 'from-alpha',
          provider: 'alpha',
          model: request.model ?? 'unknown',
          resolvedProvider: 'alpha',
          resolvedModel: request.model ?? 'unknown',
          fallbackUsed: false,
        };
      },
    });
    router.register(createMockProvider({
      id: 'beta',
      name: 'Beta',
      type: 'api',
      models: [{ id: 'beta-model', name: 'Beta Model', provider: 'beta', maxTokens: 4096 }],
      response: {
        text: 'from-beta',
        provider: 'beta',
        model: 'beta-model',
        resolvedProvider: 'beta',
        resolvedModel: 'beta-model',
        fallbackUsed: false,
      },
    }));

    const result = await router.generate({
      prompt: 'test',
      provider: 'alpha',
      model: 'beta-model',
      strict: true,
    });

    assert.equal(result.provider, 'alpha');
    assert.equal(result.requestedProvider, 'alpha');
    assert.equal(result.requestedModel, 'beta-model');
    assert.equal(result.resolvedProvider, 'alpha');
    assert.equal(result.resolvedModel, 'beta-model');
    assert.equal(alphaRequest?.provider, 'alpha');
    assert.equal(alphaRequest?.model, 'beta-model');
    assert.equal(result.routing?.strategy, 'explicit-provider');
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
      response: { text: 'from-backup', provider: 'backup', model: 'backup-model', resolvedProvider: 'backup', resolvedModel: 'backup-model', fallbackUsed: false },
    }));

    const result = await router.generate({ prompt: 'test' });
    assert.equal(result.text, 'from-backup');
    assert.equal(result.provider, 'backup');
    assert.equal(result.resolvedProvider, 'backup');
    assert.equal(result.resolvedModel, 'backup-model');
    assert.equal(result.fallbackUsed, true);
  });

  it('does not auto-fallback to Anthropic providers after an explicit provider fails', async () => {
    const router = new Router();
    const claudeGenerate = mock.fn(async () => ({
      text: 'from-claude',
      provider: 'claude-cli',
      model: 'claude-model',
      resolvedProvider: 'claude-cli',
      resolvedModel: 'claude-model',
      fallbackUsed: false,
    }));
    const anthropicGenerate = mock.fn(async () => ({
      text: 'from-anthropic',
      provider: 'anthropic',
      model: 'claude-api-model',
      resolvedProvider: 'anthropic',
      resolvedModel: 'claude-api-model',
      fallbackUsed: false,
    }));

    router.register(createMockProvider({
      id: 'opencode-cli',
      name: 'OpenCode CLI',
      type: 'cli',
      models: [{ id: 'opencode-model', name: 'OpenCode Model', provider: 'opencode-cli', maxTokens: 4096 }],
      shouldFail: true,
      failMessage: 'opencode unavailable',
    }));
    router.register({
      ...createMockProvider({
        id: 'claude-cli',
        name: 'Claude CLI',
        type: 'cli',
        models: [{ id: 'claude-model', name: 'Claude Model', provider: 'claude-cli', maxTokens: 4096 }],
      }),
      generate: claudeGenerate,
    });
    router.register({
      ...createMockProvider({
        id: 'anthropic',
        name: 'Anthropic',
        type: 'api',
        models: [{ id: 'claude-api-model', name: 'Claude API Model', provider: 'anthropic', maxTokens: 4096 }],
      }),
      generate: anthropicGenerate,
    });
    const geminiGenerate = mock.fn(async () => ({
      text: 'from-gemini',
      provider: 'gemini-cli',
      model: 'gemini-model',
      resolvedProvider: 'gemini-cli',
      resolvedModel: 'gemini-model',
      fallbackUsed: false,
    }));

    router.register({
      ...createMockProvider({
        id: 'gemini-cli',
        name: 'Gemini CLI',
        type: 'cli',
        models: [{ id: 'gemini-model', name: 'Gemini Model', provider: 'gemini-cli', maxTokens: 4096 }],
      }),
      generate: geminiGenerate,
    });

    await assert.rejects(
      () => router.generate({ prompt: 'test', provider: 'opencode-cli' }),
      /opencode unavailable/,
    );
    assert.equal(claudeGenerate.mock.callCount(), 0);
    assert.equal(anthropicGenerate.mock.callCount(), 0);
    assert.equal(geminiGenerate.mock.callCount(), 0);
  });

  it('does not use bridge fallback_order when an explicit provider fails', async () => {
    const router = new Router();
    const anthropicGenerate = mock.fn(async () => ({
      text: 'from-anthropic',
      provider: 'anthropic',
      model: 'claude-api-model',
      resolvedProvider: 'anthropic',
      resolvedModel: 'claude-api-model',
      fallbackUsed: false,
    }));

    router.setBridgeFallbackOrder(['anthropic']);
    router.register(createMockProvider({
      id: 'opencode-cli',
      name: 'OpenCode CLI',
      type: 'cli',
      models: [{ id: 'opencode-model', name: 'OpenCode Model', provider: 'opencode-cli', maxTokens: 4096 }],
      shouldFail: true,
      failMessage: 'opencode unavailable',
    }));
    router.register({
      ...createMockProvider({
        id: 'anthropic',
        name: 'Anthropic',
        type: 'api',
        models: [{ id: 'claude-api-model', name: 'Claude API Model', provider: 'anthropic', maxTokens: 4096 }],
      }),
      generate: anthropicGenerate,
    });
    router.register(createMockProvider({
      id: 'gemini-cli',
      name: 'Gemini CLI',
      type: 'cli',
      models: [{ id: 'gemini-model', name: 'Gemini Model', provider: 'gemini-cli', maxTokens: 4096 }],
      response: { text: 'from-gemini', provider: 'gemini-cli', model: 'gemini-model', resolvedProvider: 'gemini-cli', resolvedModel: 'gemini-model', fallbackUsed: false },
    }));

    await assert.rejects(
      () => router.generate({ prompt: 'test', provider: 'opencode-cli' }),
      /opencode unavailable/,
    );
    assert.equal(anthropicGenerate.mock.callCount(), 0);
  });

  it('throws immediately in strict mode when first candidate fails', async () => {
    const router = new Router();
    const backupGenerate = mock.fn(async () => ({
      text: 'from-backup',
      provider: 'backup',
      model: 'backup-model',
      resolvedProvider: 'backup',
      resolvedModel: 'backup-model',
      fallbackUsed: false,
    }));

    router.register(createMockProvider({
      id: 'failing',
      name: 'Failing',
      type: 'api',
      models: [{ id: 'fail-model', name: 'Fail Model', provider: 'failing', maxTokens: 4096 }],
      shouldFail: true,
      failMessage: 'Gemini provider failed',
    }));
    router.register({
      ...createMockProvider({
        id: 'backup',
        name: 'Backup',
        type: 'api',
        models: [{ id: 'backup-model', name: 'Backup Model', provider: 'backup', maxTokens: 4096 }],
      }),
      generate: backupGenerate,
    });

    await assert.rejects(
      () => router.generate({ prompt: 'test', strict: true }),
      /Gemini provider failed/,
    );
    assert.equal(backupGenerate.mock.callCount(), 0);
  });

  it('tries the second provider when strict mode is disabled', async () => {
    const router = new Router();
    const backupGenerate = mock.fn(async () => ({
      text: 'from-backup',
      provider: 'backup',
      model: 'backup-model',
      resolvedProvider: 'backup',
      resolvedModel: 'backup-model',
      fallbackUsed: false,
    }));

    router.register(createMockProvider({
      id: 'failing',
      name: 'Failing',
      type: 'api',
      models: [{ id: 'fail-model', name: 'Fail Model', provider: 'failing', maxTokens: 4096 }],
      shouldFail: true,
      failMessage: 'API rate limit exceeded',
    }));
    router.register({
      ...createMockProvider({
        id: 'backup',
        name: 'Backup',
        type: 'api',
        models: [{ id: 'backup-model', name: 'Backup Model', provider: 'backup', maxTokens: 4096 }],
      }),
      generate: backupGenerate,
    });

    const result = await router.generate({ prompt: 'test', strict: false });
    assert.equal(result.provider, 'backup');
    assert.equal(result.fallbackUsed, true);
    assert.equal(backupGenerate.mock.callCount(), 1);
  });

  it('fails in strict mode when the resolved candidate is breaker-blocked', async () => {
    const router = new Router();
    const backupGenerate = mock.fn(async () => ({
      text: 'from-backup',
      provider: 'backup',
      model: 'backup-model',
      resolvedProvider: 'backup',
      resolvedModel: 'backup-model',
      fallbackUsed: false,
    }));

    router.register(createMockProvider({
      id: 'primary',
      name: 'Primary',
      type: 'api',
      models: [{ id: 'primary-model', name: 'Primary Model', provider: 'primary', maxTokens: 4096 }],
    }));
    router.register({
      ...createMockProvider({
        id: 'backup',
        name: 'Backup',
        type: 'api',
        models: [{ id: 'backup-model', name: 'Backup Model', provider: 'backup', maxTokens: 4096 }],
      }),
      generate: backupGenerate,
    });

    const previousFlag = process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'];
    process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'] = 'true';

    try {
      const circuitBreaker = getCircuitBreakerV2();
      for (let index = 0; index < 5; index++) {
        circuitBreaker.recordFailure('primary', 'default', 'primary-model');
      }

      await assert.rejects(
        () => router.generate({ prompt: 'test', model: 'primary-model', strict: true }),
        /Strict mode candidate primary is blocked by an open circuit breaker/,
      );
      assert.equal(backupGenerate.mock.callCount(), 0);
    } finally {
      if (previousFlag === undefined) {
        delete process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'];
      } else {
        process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'] = previousFlag;
      }
    }
  });

  it('does not use a backup provider when strict mode targets an explicit provider', async () => {
    const router = new Router();
    const backupGenerate = mock.fn(async () => ({
      text: 'from-backup',
      provider: 'backup',
      model: 'backup-model',
      resolvedProvider: 'backup',
      resolvedModel: 'backup-model',
      fallbackUsed: false,
    }));

    router.register(createMockProvider({
      id: 'primary',
      name: 'Primary',
      type: 'api',
      models: [{ id: 'primary-model', name: 'Primary Model', provider: 'primary', maxTokens: 4096 }],
      shouldFail: true,
      failMessage: 'primary exploded',
    }));
    router.register({
      ...createMockProvider({
        id: 'backup',
        name: 'Backup',
        type: 'api',
        models: [{ id: 'backup-model', name: 'Backup Model', provider: 'backup', maxTokens: 4096 }],
      }),
      generate: backupGenerate,
    });

    await assert.rejects(
      () => router.generate({ prompt: 'test', provider: 'primary', strict: true }),
      /primary exploded/,
    );
    assert.equal(backupGenerate.mock.callCount(), 0);
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
      response: { text: 'from-cli', provider: 'cli-first', model: 'cli-m', resolvedProvider: 'cli-first', resolvedModel: 'cli-m', fallbackUsed: false },
    }));
    router.register(createMockProvider({
      id: 'api-second',
      name: 'API Second',
      type: 'api',
      models: [{ id: 'api-m', name: 'API M', provider: 'api-second', maxTokens: 4096 }],
      response: { text: 'from-api', provider: 'api-second', model: 'api-m', resolvedProvider: 'api-second', resolvedModel: 'api-m', fallbackUsed: false },
    }));

    // Without specifying provider/model, API should be tried first
    const result = await router.generate({ prompt: 'test' });
    assert.equal(result.provider, 'api-second', 'API provider should be tried before CLI');
    assert.equal(result.fallbackUsed, false);
  });
});
