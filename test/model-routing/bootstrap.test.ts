/**
 * Bootstrap tests — createModelRouter() wiring logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createModelRouter } from '../../src/model-routing/bootstrap.js';
import { ModelRouter } from '../../src/model-routing/router.js';
import { COST_TIER } from '../../src/model-routing/types.js';
import type { ModelRoutingConfig, ModelEndpoint } from '../../src/model-routing/types.js';
import type { LLMProvider } from '../../src/core/types.js';

// ── Fixtures ──────────────────────────────────────────────

function makeProvider(id: string): LLMProvider {
  return {
    id,
    name: id,
    type: 'api',
    models: [],
    generate: async () => ({ text: '', provider: id, model: '', resolvedProvider: id, resolvedModel: '', fallbackUsed: false }),
    isAvailable: async () => true,
  };
}

function makeEndpoint(id: string, provider: string): ModelEndpoint {
  return {
    id,
    name: id,
    provider,
    modelId: `${id}-model`,
    costTier: COST_TIER.STANDARD,
    capabilities: ['chat'],
    isLocal: false,
    maxTokens: 4096,
    available: false, // will be set by bootstrap
  };
}

function makeConfig(endpoints: ModelEndpoint[]): ModelRoutingConfig {
  return {
    enabled: true,
    endpoints,
    rules: [],
    defaultEndpoint: endpoints[0]?.id ?? '',
    qualityThreshold: 0.7,
    qualityWindowSize: 50,
  };
}

// ── Tests ─────────────────────────────────────────────────

describe('createModelRouter', () => {
  it('creates ModelRouter with matching providers', () => {
    const provider = makeProvider('openai');
    const endpoint = makeEndpoint('gpt-4', 'openai');
    const config = makeConfig([endpoint]);

    const router = createModelRouter(new Map([['openai', provider]]), config);

    assert.ok(router instanceof ModelRouter);
    assert.equal(router.enabled, true);
    const [endpointByCost] = router.getEndpointsByCost();
    assert.ok(endpointByCost);
    assert.equal(router.getEndpointsByCost().length, 1);
    assert.equal(endpointByCost.id, 'gpt-4');
    assert.equal(endpointByCost.available, true);
  });

  it('returns null when config is null', () => {
    const provider = makeProvider('openai');
    const router = createModelRouter(new Map([['openai', provider]]), null);

    assert.equal(router, null);
  });

  it('returns null when config.enabled === false', () => {
    const provider = makeProvider('openai');
    const endpoint = makeEndpoint('gpt-4', 'openai');
    const config = { ...makeConfig([endpoint]), enabled: false };

    const router = createModelRouter(new Map([['openai', provider]]), config);

    assert.equal(router, null);
  });

  it('returns null when no matching providers', () => {
    const provider = makeProvider('ollama');
    const endpoint = makeEndpoint('gpt-4', 'openai'); // requires 'openai' provider
    const config = makeConfig([endpoint]);

    const router = createModelRouter(new Map([['ollama', provider]]), config);

    assert.equal(router, null);
  });

  it('maps provider metadata correctly', () => {
    const providerA = makeProvider('openai');
    const providerB = makeProvider('anthropic');
    const epA = makeEndpoint('gpt-4', 'openai');
    const epB = makeEndpoint('claude', 'anthropic');
    const config = makeConfig([epA, epB]);

    const router = createModelRouter(
      new Map([
        ['openai', providerA],
        ['anthropic', providerB],
      ]),
      config,
    );

    assert.ok(router);
    const endpoints = router!.getEndpointsByCost();
    assert.equal(endpoints.length, 2);

    const mappedA = endpoints.find((e) => e.id === 'gpt-4');
    const mappedB = endpoints.find((e) => e.id === 'claude');
    assert.ok(mappedA);
    assert.ok(mappedB);
    assert.equal(mappedA!.available, true);
    assert.equal(mappedB!.available, true);
    assert.equal(mappedA!.provider, 'openai');
    assert.equal(mappedB!.provider, 'anthropic');
  });

  it('handles empty providers', () => {
    const endpoint = makeEndpoint('gpt-4', 'openai');
    const config = makeConfig([endpoint]);

    const router = createModelRouter(new Map(), config);

    assert.equal(router, null);
  });

  it('handles single provider', () => {
    const provider = makeProvider('groq');
    const endpoint = makeEndpoint('llama-3', 'groq');
    const config = makeConfig([endpoint]);

    const router = createModelRouter(new Map([['groq', provider]]), config);

    assert.ok(router instanceof ModelRouter);
    const endpoints = router.getEndpointsByCost();
    const [firstEndpoint] = endpoints;
    assert.ok(firstEndpoint);
    assert.equal(endpoints.length, 1);
    assert.equal(firstEndpoint.id, 'llama-3');
    assert.equal(firstEndpoint.available, true);
  });

  it('handles multiple providers', () => {
    const providers = new Map<string, LLMProvider>([
      ['openai', makeProvider('openai')],
      ['anthropic', makeProvider('anthropic')],
      ['groq', makeProvider('groq')],
    ]);

    const endpoints = [
      makeEndpoint('gpt-4', 'openai'),
      makeEndpoint('claude-sonnet', 'anthropic'),
      makeEndpoint('llama-3', 'groq'),
    ];
    const config = makeConfig(endpoints);

    const router = createModelRouter(providers, config);

    assert.ok(router instanceof ModelRouter);
    const available = router!.getEndpointsByCost();
    assert.equal(available.length, 3);
    assert.deepEqual(
      available.map((e) => e.id).sort(),
      ['claude-sonnet', 'gpt-4', 'llama-3'].sort(),
    );
  });

  it('marks endpoint unavailable when provider is missing', () => {
    const provider = makeProvider('openai');
    const epAvailable = makeEndpoint('gpt-4', 'openai');
    const epUnavailable = makeEndpoint('claude', 'anthropic');
    const config = makeConfig([epAvailable, epUnavailable]);

    const router = createModelRouter(new Map([['openai', provider]]), config);

    assert.ok(router);
    const endpoints = router.getEndpointsByCost();
    const [firstEndpoint] = endpoints;
    assert.ok(firstEndpoint);
    assert.equal(endpoints.length, 1); // only available ones returned
    assert.equal(firstEndpoint.id, 'gpt-4');

    // Verify the unavailable endpoint exists but is marked unavailable
    const allEndpoints = (router as any).config.endpoints as ModelEndpoint[];
    const claudeEp = allEndpoints.find((e) => e.id === 'claude');
    assert.ok(claudeEp);
    assert.equal(claudeEp!.available, false);
  });

  it('returns router when at least one endpoint matches even if others do not', () => {
    const provider = makeProvider('openai');
    const endpoints = [
      makeEndpoint('missing-1', 'foo'),
      makeEndpoint('missing-2', 'bar'),
      makeEndpoint('gpt-4', 'openai'),
    ];
    const config = makeConfig(endpoints);

    const router = createModelRouter(new Map([['openai', provider]]), config);

    assert.ok(router instanceof ModelRouter);
    assert.equal(router!.getEndpointsByCost().length, 1);
  });
});
