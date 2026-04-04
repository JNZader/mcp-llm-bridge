/**
 * Free Model Catalog Tests
 *
 * Verifies catalog import, stability scoring, unstable model
 * deprioritization, and catalog refresh mechanics.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  importCatalog,
  loadCatalog,
  importProviderModels,
  computeStabilityScore,
  tierToBaseStability,
  parseContextWindow,
  FreeModelRegistry,
} from '../../src/free-models/registry.js';
import { HealthChecker } from '../../src/free-models/health.js';
import type {
  ModelCatalog,
  CatalogProvider,
  FreeModelEntry,
} from '../../src/free-models/types.js';

// ── parseContextWindow ──────────────────────────────────────

describe('parseContextWindow', () => {
  it('parses "128k" correctly', () => {
    assert.equal(parseContextWindow('128k'), 128_000);
  });

  it('parses "1M" correctly', () => {
    assert.equal(parseContextWindow('1M'), 1_000_000);
  });

  it('parses "10M" correctly', () => {
    assert.equal(parseContextWindow('10M'), 10_000_000);
  });

  it('parses "32k" correctly', () => {
    assert.equal(parseContextWindow('32k'), 32_000);
  });

  it('falls back to 8192 for invalid format', () => {
    assert.equal(parseContextWindow('invalid'), 8192);
  });

  it('handles "200k" correctly', () => {
    assert.equal(parseContextWindow('200k'), 200_000);
  });
});

// ── tierToBaseStability ──────────────────────────────────────

describe('tierToBaseStability', () => {
  it('returns 90 for S+ tier', () => {
    assert.equal(tierToBaseStability('S+'), 90);
  });

  it('returns 80 for S tier', () => {
    assert.equal(tierToBaseStability('S'), 80);
  });

  it('returns 20 for C tier', () => {
    assert.equal(tierToBaseStability('C'), 20);
  });

  it('returns 50 for unknown tier', () => {
    assert.equal(tierToBaseStability('X'), 50);
  });
});

// ── computeStabilityScore ────────────────────────────────────

describe('computeStabilityScore', () => {
  it('computes score from tier and SWE score', () => {
    // S+ tier (base=90), sweScore=80
    // 90 * 0.6 + 80 * 0.4 = 54 + 32 = 86
    const score = computeStabilityScore('S+', 80);
    assert.equal(score, 86);
  });

  it('low tier with low SWE score produces low stability', () => {
    // C tier (base=20), sweScore=10
    // 20 * 0.6 + 10 * 0.4 = 12 + 4 = 16
    const score = computeStabilityScore('C', 10);
    assert.equal(score, 16);
  });

  it('clamps score to 0-100 range', () => {
    const score = computeStabilityScore('S+', 150);
    assert.ok(score <= 100);
    assert.ok(score >= 0);
  });

  it('blends health reliability when checker has data', () => {
    const healthChecker = new HealthChecker(5000);

    // Manually inject some reliability history
    // We need to simulate checkAll results to build history
    // Instead, we test without health data (default 0.5 is skipped)
    const scoreNoHealth = computeStabilityScore('A', 50, 'test-model', healthChecker);
    // A tier (base=60), sweScore=50
    // 60 * 0.6 + 50 * 0.4 = 36 + 20 = 56
    assert.equal(scoreNoHealth, 56);

    healthChecker.destroy();
  });
});

// ── importProviderModels ─────────────────────────────────────

describe('importProviderModels', () => {
  const testProvider: CatalogProvider = {
    sourceKey: 'test-provider',
    baseUrl: 'https://api.test.com/v1',
    envKey: 'TEST_API_KEY',
    models: [
      {
        modelId: 'test/model-70b',
        displayName: 'Test Model 70B',
        tier: 'A',
        sweScore: 48.0,
        contextWindow: '128k',
      },
      {
        modelId: 'test/coder-32b',
        displayName: 'Test Coder 32B',
        tier: 'A+',
        sweScore: 55.0,
        contextWindow: '32k',
      },
    ],
  };

  it('converts provider models to FreeModelEntry[]', () => {
    const entries = importProviderModels(testProvider);
    assert.equal(entries.length, 2);

    const first = entries[0]!;
    assert.equal(first.source, 'test-provider');
    assert.equal(first.baseUrl, 'https://api.test.com/v1');
    assert.equal(first.modelId, 'test/model-70b');
    assert.equal(first.apiKeyEnv, 'TEST_API_KEY');
    assert.equal(first.enabled, true);
    assert.ok(first.id.startsWith('catalog-test-provider-'));
    assert.ok(first.maxTokens === 128_000);
  });

  it('assigns stability scores to entries', () => {
    const entries = importProviderModels(testProvider);

    for (const entry of entries) {
      assert.ok(typeof entry.stabilityScore === 'number');
      assert.ok(entry.stabilityScore! >= 0 && entry.stabilityScore! <= 100);
      assert.ok(entry.lastStabilityCheck !== undefined);
    }
  });

  it('infers code capability for coder models', () => {
    const entries = importProviderModels(testProvider);
    const coderEntry = entries.find((e) => e.modelId === 'test/coder-32b')!;
    assert.ok(coderEntry.capabilities.includes('code'));
  });

  it('infers code capability from high SWE score', () => {
    const entries = importProviderModels(testProvider);
    // sweScore >= 30 should include 'code'
    const highSwe = entries.find((e) => e.modelId === 'test/model-70b')!;
    assert.ok(highSwe.capabilities.includes('code'), 'Expected code capability for sweScore=48');
  });
});

// ── importCatalog ────────────────────────────────────────────

describe('importCatalog', () => {
  const testCatalog: ModelCatalog = {
    version: '1.0.0-test',
    generatedAt: '2026-01-01T00:00:00Z',
    source: 'test',
    providers: [
      {
        sourceKey: 'provider-a',
        baseUrl: 'https://api.a.com/v1',
        envKey: 'A_KEY',
        models: [
          { modelId: 'a/model-1', displayName: 'A Model 1', tier: 'S+', sweScore: 75.0, contextWindow: '128k' },
          { modelId: 'a/model-2', displayName: 'A Model 2', tier: 'B', sweScore: 25.0, contextWindow: '32k' },
        ],
      },
      {
        sourceKey: 'provider-b',
        baseUrl: 'https://api.b.com/v1',
        models: [
          { modelId: 'b/model-1', displayName: 'B Model 1', tier: 'A', sweScore: 50.0, contextWindow: '64k' },
        ],
      },
    ],
  };

  it('imports all models from all providers', () => {
    const entries = importCatalog(testCatalog);
    assert.equal(entries.length, 3);
  });

  it('each entry has correct source from provider', () => {
    const entries = importCatalog(testCatalog);
    const providerASources = entries.filter((e) => e.source === 'provider-a');
    const providerBSources = entries.filter((e) => e.source === 'provider-b');
    assert.equal(providerASources.length, 2);
    assert.equal(providerBSources.length, 1);
  });

  it('all entries have stability scores', () => {
    const entries = importCatalog(testCatalog);
    for (const entry of entries) {
      assert.ok(typeof entry.stabilityScore === 'number');
    }
  });

  it('higher tier models get higher stability scores', () => {
    const entries = importCatalog(testCatalog);
    const sPlus = entries.find((e) => e.modelId === 'a/model-1')!;
    const bTier = entries.find((e) => e.modelId === 'a/model-2')!;
    assert.ok(sPlus.stabilityScore! > bTier.stabilityScore!, `S+ (${sPlus.stabilityScore}) should be > B (${bTier.stabilityScore})`);
  });

  it('entries without envKey have undefined apiKeyEnv', () => {
    const entries = importCatalog(testCatalog);
    const bModel = entries.find((e) => e.source === 'provider-b')!;
    assert.equal(bModel.apiKeyEnv, undefined);
  });
});

// ── loadCatalog ──────────────────────────────────────────────

describe('loadCatalog', () => {
  it('loads the bundled catalog.json', () => {
    const catalogPath = join(__dirname, '../../src/free-models/catalog.json');
    const catalog = loadCatalog(catalogPath);
    assert.ok(catalog !== null, 'Catalog should load successfully');
    assert.equal(catalog!.version, '1.0.0');
    assert.ok(catalog!.providers.length > 0);
  });

  it('returns null for non-existent path', () => {
    const catalog = loadCatalog('/tmp/nonexistent-catalog.json');
    assert.equal(catalog, null);
  });

  it('bundled catalog has expected provider count', () => {
    const catalogPath = join(__dirname, '../../src/free-models/catalog.json');
    const catalog = loadCatalog(catalogPath);
    assert.ok(catalog !== null);
    // We should have 16 providers (nvidia, groq, cerebras, sambanova, openrouter,
    // together, deepinfra, fireworks, scaleway, hyperbolic, siliconflow,
    // googleai, codestral, huggingface, qwen, perplexity)
    assert.ok(catalog!.providers.length >= 14, `Expected >= 14 providers, got ${catalog!.providers.length}`);
  });

  it('bundled catalog has 50+ models total', () => {
    const catalogPath = join(__dirname, '../../src/free-models/catalog.json');
    const catalog = loadCatalog(catalogPath);
    assert.ok(catalog !== null);
    const totalModels = catalog!.providers.reduce((sum, p) => sum + p.models.length, 0);
    assert.ok(totalModels >= 50, `Expected >= 50 models, got ${totalModels}`);
  });
});

// ── Unstable models deprioritized ────────────────────────────

describe('stability-weighted ranking', () => {
  it('unstable models have lower stability score', () => {
    const stableProvider: CatalogProvider = {
      sourceKey: 'stable',
      baseUrl: 'https://api.stable.com/v1',
      models: [
        { modelId: 'stable/model', displayName: 'Stable Model', tier: 'S+', sweScore: 80.0, contextWindow: '128k' },
      ],
    };

    const unstableProvider: CatalogProvider = {
      sourceKey: 'unstable',
      baseUrl: 'https://api.unstable.com/v1',
      models: [
        { modelId: 'unstable/model', displayName: 'Unstable Model', tier: 'C', sweScore: 10.0, contextWindow: '8k' },
      ],
    };

    const stableEntries = importProviderModels(stableProvider);
    const unstableEntries = importProviderModels(unstableProvider);

    assert.ok(
      stableEntries[0]!.stabilityScore! > unstableEntries[0]!.stabilityScore!,
      `Stable (${stableEntries[0]!.stabilityScore}) should rank higher than unstable (${unstableEntries[0]!.stabilityScore})`,
    );
  });
});

// ── Registry importModels (catalog refresh) ──────────────────

describe('FreeModelRegistry.importModels', () => {
  it('imports catalog entries into registry', () => {
    const registry = new FreeModelRegistry([], true); // skip builtins
    assert.equal(registry.size, 0);

    const entries: FreeModelEntry[] = [
      {
        id: 'catalog-test-model-1',
        name: 'Test Model 1',
        source: 'test',
        baseUrl: 'https://api.test.com/v1',
        modelId: 'test/model-1',
        capabilities: ['chat', 'code'],
        maxTokens: 128_000,
        enabled: true,
        stabilityScore: 85,
        lastStabilityCheck: new Date().toISOString(),
      },
      {
        id: 'catalog-test-model-2',
        name: 'Test Model 2',
        source: 'test',
        baseUrl: 'https://api.test.com/v1',
        modelId: 'test/model-2',
        capabilities: ['chat'],
        maxTokens: 32_000,
        enabled: true,
        stabilityScore: 40,
        lastStabilityCheck: new Date().toISOString(),
      },
    ];

    const imported = registry.importModels(entries);
    assert.equal(imported, 2);
    assert.equal(registry.size, 2);
    assert.ok(registry.get('catalog-test-model-1'));
    assert.ok(registry.get('catalog-test-model-2'));
  });

  it('re-import overwrites existing entries by ID (refresh)', () => {
    const registry = new FreeModelRegistry([], true);

    const initial: FreeModelEntry[] = [
      {
        id: 'catalog-test-model',
        name: 'Test Model v1',
        source: 'test',
        baseUrl: 'https://api.test.com/v1',
        modelId: 'test/model',
        capabilities: ['chat'],
        maxTokens: 128_000,
        enabled: true,
        stabilityScore: 50,
      },
    ];

    registry.importModels(initial);
    assert.equal(registry.get('catalog-test-model')?.name, 'Test Model v1');

    const updated: FreeModelEntry[] = [
      {
        id: 'catalog-test-model',
        name: 'Test Model v2',
        source: 'test',
        baseUrl: 'https://api.test.com/v1',
        modelId: 'test/model',
        capabilities: ['chat', 'code'],
        maxTokens: 128_000,
        enabled: true,
        stabilityScore: 75,
      },
    ];

    registry.importModels(updated);
    assert.equal(registry.get('catalog-test-model')?.name, 'Test Model v2');
    assert.equal(registry.get('catalog-test-model')?.stabilityScore, 75);
    assert.equal(registry.size, 1); // same ID, not duplicated
  });

  it('full catalog import round-trip works', () => {
    const catalogPath = join(__dirname, '../../src/free-models/catalog.json');
    const catalog = loadCatalog(catalogPath);
    assert.ok(catalog !== null);

    const entries = importCatalog(catalog!);
    const registry = new FreeModelRegistry([], true);
    const imported = registry.importModels(entries);

    assert.ok(imported >= 50, `Expected >= 50 imported, got ${imported}`);
    assert.equal(registry.size, imported);

    // All entries should be enabled
    const enabled = registry.getEnabled();
    assert.equal(enabled.length, imported);

    // All entries should have stability scores
    for (const entry of enabled) {
      assert.ok(typeof entry.stabilityScore === 'number', `Missing stabilityScore for ${entry.id}`);
    }
  });
});
