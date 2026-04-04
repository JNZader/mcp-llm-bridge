/**
 * Router latency integration tests — Verifies that the Router correctly
 * uses LatencyMeasurer data to reorder candidates via epsilon-greedy.
 *
 * Tests:
 * - Fastest provider selected when latency data available
 * - Epsilon exploration triggers random selection
 * - No latency data falls back to default ordering
 * - Stale measurements are ignored
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Router, resetCircuitBreakerV2 } from '../src/core/router.js';
import { LatencyMeasurer } from '../src/latency/measurer.js';
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
}): LLMProvider {
  return {
    id: opts.id,
    name: opts.name,
    type: opts.type,
    models: opts.models,

    async generate(_request: GenerateRequest): Promise<GenerateResponse> {
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

function makeModel(provider: string, modelId: string): ModelInfo {
  return { id: modelId, name: modelId, provider, maxTokens: 4096 };
}

describe('Router latency-based routing', () => {
  let originalRandom: typeof Math.random;

  beforeEach(() => {
    originalRandom = Math.random;
    resetCircuitBreakerV2();
  });

  afterEach(() => {
    Math.random = originalRandom;
    resetCircuitBreakerV2();
  });

  it('fastest provider selected when latency data is available', async () => {
    const router = new Router();

    const slowProvider = createMockProvider({
      id: 'slow-provider',
      name: 'Slow',
      type: 'api',
      models: [makeModel('slow-provider', 'model-a')],
    });

    const fastProvider = createMockProvider({
      id: 'fast-provider',
      name: 'Fast',
      type: 'api',
      models: [makeModel('fast-provider', 'model-b')],
    });

    // Register slow first so default ordering would pick it first
    router.register(slowProvider);
    router.register(fastProvider);

    // Set up latency measurer with fast < slow
    // Manually inject measurements by calling measure with mock URLs
    // We'll directly set measurements via the internal map by measuring known providers
    // Instead, use the public API: measure() does a real fetch, so we'll mock it
    // by directly accessing the internal state through getAll() pattern.
    // Better: create measurements by direct assignment via measure results.

    // Use a short TTL measurer and manually set measurements
    const shortTTLMeasurer = new LatencyMeasurer(60_000); // 1 min TTL

    // We can't easily mock fetch in node:test, so we'll create a measurer
    // and inject measurements by leveraging the fact that measure() stores results.
    // Instead, let's create a custom subclass or use the internal state.
    // Simplest: use Object.defineProperty to access the private measurements map.

    // Access private measurements map via prototype trick
    const measurerAny = shortTTLMeasurer as unknown as {
      measurements: Map<string, { provider: string; url: string; latencyMs: number; measuredAt: number }>;
    };

    measurerAny.measurements.set('fast-provider', {
      provider: 'fast-provider',
      url: 'https://fast.example.com',
      latencyMs: 50,
      measuredAt: Date.now(),
    });

    measurerAny.measurements.set('slow-provider', {
      provider: 'slow-provider',
      url: 'https://slow.example.com',
      latencyMs: 200,
      measuredAt: Date.now(),
    });

    router.setLatencyMeasurer(shortTTLMeasurer);

    // Force Math.random to always return > 0.1 (exploit mode, no exploration)
    Math.random = () => 0.5;

    const result = await router.generate({ prompt: 'test' });
    assert.equal(result.resolvedProvider, 'fast-provider');
  });

  it('epsilon exploration triggers random selection when Math.random < explorationRate', async () => {
    const router = new Router();

    const providerA = createMockProvider({
      id: 'provider-a',
      name: 'Provider A',
      type: 'api',
      models: [makeModel('provider-a', 'model-a')],
    });

    const providerB = createMockProvider({
      id: 'provider-b',
      name: 'Provider B',
      type: 'api',
      models: [makeModel('provider-b', 'model-b')],
    });

    router.register(providerA);
    router.register(providerB);

    const measurer = new LatencyMeasurer(60_000);
    const measurerAny = measurer as unknown as {
      measurements: Map<string, { provider: string; url: string; latencyMs: number; measuredAt: number }>;
    };

    // Provider A is much faster
    measurerAny.measurements.set('provider-a', {
      provider: 'provider-a',
      url: 'https://a.example.com',
      latencyMs: 50,
      measuredAt: Date.now(),
    });

    measurerAny.measurements.set('provider-b', {
      provider: 'provider-b',
      url: 'https://b.example.com',
      latencyMs: 200,
      measuredAt: Date.now(),
    });

    router.setLatencyMeasurer(measurer);

    // First call to Math.random: epsilon check (< 0.1 = exploration mode)
    // Second call: random index selection (0.5 * 2 = index 1 = provider-b)
    let callCount = 0;
    Math.random = () => {
      callCount++;
      if (callCount === 1) return 0.05; // < 0.1 → exploration
      return 0.5; // floor(0.5 * 2) = 1 → picks provider-b (the slower one)
    };

    const result = await router.generate({ prompt: 'test' });
    // In exploration mode, the random index picks provider-b
    assert.equal(result.resolvedProvider, 'provider-b');
  });

  it('no latency data falls back to default ordering', async () => {
    const router = new Router();

    const apiProvider = createMockProvider({
      id: 'api-provider',
      name: 'API Provider',
      type: 'api',
      models: [makeModel('api-provider', 'model-api')],
    });

    const cliProvider = createMockProvider({
      id: 'cli-provider',
      name: 'CLI Provider',
      type: 'cli',
      models: [makeModel('cli-provider', 'model-cli')],
    });

    // Register CLI first, but API should still come first in default ordering
    router.register(cliProvider);
    router.register(apiProvider);

    // Set a measurer with NO measurements
    const measurer = new LatencyMeasurer(60_000);
    router.setLatencyMeasurer(measurer);

    Math.random = () => 0.5; // No exploration

    const result = await router.generate({ prompt: 'test' });
    // Default ordering: API first, then CLI
    assert.equal(result.resolvedProvider, 'api-provider');
  });

  it('stale measurements are ignored and default ordering used', async () => {
    const router = new Router();

    const providerA = createMockProvider({
      id: 'provider-a',
      name: 'Provider A',
      type: 'api',
      models: [makeModel('provider-a', 'model-a')],
    });

    const providerB = createMockProvider({
      id: 'provider-b',
      name: 'Provider B',
      type: 'api',
      models: [makeModel('provider-b', 'model-b')],
    });

    router.register(providerA);
    router.register(providerB);

    // Use a very short TTL (1ms) so measurements expire immediately
    const measurer = new LatencyMeasurer(1);
    const measurerAny = measurer as unknown as {
      measurements: Map<string, { provider: string; url: string; latencyMs: number; measuredAt: number }>;
    };

    // Set measurements with old timestamp (beyond TTL)
    measurerAny.measurements.set('provider-b', {
      provider: 'provider-b',
      url: 'https://b.example.com',
      latencyMs: 10, // Would be fastest, but it's stale
      measuredAt: Date.now() - 10_000, // 10 seconds ago, well past 1ms TTL
    });

    measurerAny.measurements.set('provider-a', {
      provider: 'provider-a',
      url: 'https://a.example.com',
      latencyMs: 500, // Slow, but also stale
      measuredAt: Date.now() - 10_000,
    });

    router.setLatencyMeasurer(measurer);

    Math.random = () => 0.5; // No exploration

    const result = await router.generate({ prompt: 'test' });
    // All measurements are stale → getAll() returns empty → default ordering
    // Default ordering: both are 'api', so registration order preserved
    assert.equal(result.resolvedProvider, 'provider-a');
  });

  it('no measurer set uses default ordering without error', async () => {
    const router = new Router();

    const provider = createMockProvider({
      id: 'solo',
      name: 'Solo',
      type: 'api',
      models: [makeModel('solo', 'model-solo')],
    });

    router.register(provider);
    // Do NOT set latency measurer

    const result = await router.generate({ prompt: 'test' });
    assert.equal(result.resolvedProvider, 'solo');
  });

  it('setExplorationRate clamps value between 0 and 1', () => {
    const router = new Router();

    router.setExplorationRate(0.5);
    assert.equal(router.explorationRate, 0.5);

    router.setExplorationRate(-0.1);
    assert.equal(router.explorationRate, 0);

    router.setExplorationRate(1.5);
    assert.equal(router.explorationRate, 1);
  });
});
