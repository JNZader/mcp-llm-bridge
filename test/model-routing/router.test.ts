/**
 * Model router tests — routing decisions, quality tracking, cost ranking.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ModelRouter, rankEndpointsByCost } from '../../src/model-routing/router.js';
import { COST_TIER } from '../../src/model-routing/types.js';
import { OFFLOAD_TASK } from '../../src/local-llm/types.js';
import type { ModelEndpoint, RouteRule, ModelRoutingConfig } from '../../src/model-routing/types.js';

// ── Fixtures ──────────────────────────────────────────────

const localEndpoint: ModelEndpoint = {
  id: 'local-llama',
  name: 'Llama 3.2 3B',
  provider: 'ollama',
  modelId: 'llama3.2:3b',
  costTier: COST_TIER.FREE,
  capabilities: ['chat', 'code'],
  isLocal: true,
  maxTokens: 8192,
  available: true,
};

const cheapEndpoint: ModelEndpoint = {
  id: 'groq-llama',
  name: 'Groq Llama',
  provider: 'groq',
  modelId: 'llama-3.1-8b-instant',
  costTier: COST_TIER.CHEAP,
  capabilities: ['chat', 'code'],
  isLocal: false,
  maxTokens: 32768,
  available: true,
};

const expensiveEndpoint: ModelEndpoint = {
  id: 'claude-sonnet',
  name: 'Claude Sonnet',
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-20250514',
  costTier: COST_TIER.EXPENSIVE,
  capabilities: ['chat', 'code', 'reasoning'],
  isLocal: false,
  maxTokens: 200000,
  available: true,
};

const commitRule: RouteRule = {
  id: 'commit-rule',
  taskPattern: OFFLOAD_TASK.COMMIT_MESSAGE,
  preferredModels: ['local-llama', 'groq-llama'],
  maxCostTier: COST_TIER.CHEAP,
  minQuality: 'medium',
  allowFallback: true,
};

const boilerplateRule: RouteRule = {
  id: 'boilerplate-rule',
  taskPattern: OFFLOAD_TASK.BOILERPLATE,
  preferredModels: ['local-llama'],
  maxCostTier: COST_TIER.FREE,
  minQuality: 'low',
  allowFallback: false,
};

function makeConfig(overrides?: Partial<ModelRoutingConfig>): Partial<ModelRoutingConfig> {
  return {
    enabled: true,
    endpoints: [localEndpoint, cheapEndpoint, expensiveEndpoint],
    rules: [commitRule, boilerplateRule],
    defaultEndpoint: 'claude-sonnet',
    qualityThreshold: 0.7,
    qualityWindowSize: 50,
    ...overrides,
  };
}

// ── ModelRouter.route ──────────────────────────────────────

describe('ModelRouter', () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter(makeConfig());
  });

  describe('route', () => {
    it('routes commit messages to local model (cheapest match)', () => {
      const decision = router.route({
        task: OFFLOAD_TASK.COMMIT_MESSAGE,
        confidence: 0.95,
        shouldOffload: true,
        reason: 'test',
      });

      assert.ok(decision);
      assert.equal(decision.endpoint.id, 'local-llama');
      assert.equal(decision.isFallback, false);
      assert.equal(decision.costTier, COST_TIER.FREE);
    });

    it('falls back to second preferred when first unavailable', () => {
      router.setEndpointAvailability('local-llama', false);

      const decision = router.route({
        task: OFFLOAD_TASK.COMMIT_MESSAGE,
        confidence: 0.95,
        shouldOffload: true,
        reason: 'test',
      });

      assert.ok(decision);
      assert.equal(decision.endpoint.id, 'groq-llama');
      assert.equal(decision.isFallback, true);
    });

    it('falls back to default when all preferred unavailable and fallback allowed', () => {
      router.setEndpointAvailability('local-llama', false);
      router.setEndpointAvailability('groq-llama', false);

      const decision = router.route({
        task: OFFLOAD_TASK.COMMIT_MESSAGE,
        confidence: 0.95,
        shouldOffload: true,
        reason: 'test',
      });

      assert.ok(decision);
      assert.equal(decision.endpoint.id, 'claude-sonnet');
      assert.equal(decision.isFallback, true);
    });

    it('returns null when fallback not allowed and no models qualify', () => {
      router.setEndpointAvailability('local-llama', false);

      const decision = router.route({
        task: OFFLOAD_TASK.BOILERPLATE,
        confidence: 0.85,
        shouldOffload: true,
        reason: 'test',
      });

      assert.equal(decision, null);
    });

    it('routes unrecognized tasks to default endpoint', () => {
      const decision = router.route({
        task: OFFLOAD_TASK.NOT_OFFLOADABLE,
        confidence: 0.5,
        shouldOffload: false,
        reason: 'test',
      });

      assert.ok(decision);
      assert.equal(decision.endpoint.id, 'claude-sonnet');
      assert.equal(decision.isFallback, true);
    });

    it('respects cost tier limits on rules', () => {
      // Boilerplate rule maxCostTier is FREE, only local-llama qualifies
      const decision = router.route({
        task: OFFLOAD_TASK.BOILERPLATE,
        confidence: 0.85,
        shouldOffload: true,
        reason: 'test',
      });

      assert.ok(decision);
      assert.equal(decision.endpoint.id, 'local-llama');
    });
  });

  describe('quality tracking', () => {
    it('skips model with low quality stats', () => {
      // Feed bad quality data for local-llama on commit messages
      for (let i = 0; i < 10; i++) {
        router.recordFeedback({
          endpointId: 'local-llama',
          taskPattern: OFFLOAD_TASK.COMMIT_MESSAGE,
          acceptable: false,
          latencyMs: 100,
          timestamp: new Date().toISOString(),
        });
      }

      const decision = router.route({
        task: OFFLOAD_TASK.COMMIT_MESSAGE,
        confidence: 0.95,
        shouldOffload: true,
        reason: 'test',
      });

      assert.ok(decision);
      // Should skip local-llama (0% acceptance) and use groq-llama
      assert.equal(decision.endpoint.id, 'groq-llama');
    });

    it('returns quality stats for tracked endpoint', () => {
      router.recordFeedback({
        endpointId: 'local-llama',
        taskPattern: OFFLOAD_TASK.COMMIT_MESSAGE,
        acceptable: true,
        latencyMs: 200,
        timestamp: new Date().toISOString(),
      });
      router.recordFeedback({
        endpointId: 'local-llama',
        taskPattern: OFFLOAD_TASK.COMMIT_MESSAGE,
        acceptable: false,
        latencyMs: 300,
        timestamp: new Date().toISOString(),
      });

      const stats = router.getQualityStats('local-llama', OFFLOAD_TASK.COMMIT_MESSAGE);
      assert.ok(stats);
      assert.equal(stats.totalRequests, 2);
      assert.equal(stats.acceptableCount, 1);
      assert.equal(stats.acceptanceRate, 0.5);
      assert.equal(stats.avgLatencyMs, 250);
    });

    it('returns null for untracked endpoint', () => {
      const stats = router.getQualityStats('unknown', OFFLOAD_TASK.COMMIT_MESSAGE);
      assert.equal(stats, null);
    });
  });

  describe('endpoint management', () => {
    it('getEndpointsByCost returns sorted by cost', () => {
      const sorted = router.getEndpointsByCost();
      assert.equal(sorted[0]!.id, 'local-llama');
      assert.equal(sorted[1]!.id, 'groq-llama');
      assert.equal(sorted[2]!.id, 'claude-sonnet');
    });

    it('getEndpointsByCost excludes unavailable', () => {
      router.setEndpointAvailability('local-llama', false);
      const sorted = router.getEndpointsByCost();
      assert.equal(sorted.length, 2);
      assert.equal(sorted[0]!.id, 'groq-llama');
    });
  });
});

// ── rankEndpointsByCost ──────────────────────────────────

describe('rankEndpointsByCost', () => {
  const endpoints = [expensiveEndpoint, localEndpoint, cheapEndpoint];

  it('sorts by cost tier ascending', () => {
    const ranked = rankEndpointsByCost(endpoints);
    assert.equal(ranked[0]!.id, 'local-llama');
    assert.equal(ranked[1]!.id, 'groq-llama');
    assert.equal(ranked[2]!.id, 'claude-sonnet');
  });

  it('filters by max cost tier', () => {
    const ranked = rankEndpointsByCost(endpoints, COST_TIER.CHEAP);
    assert.equal(ranked.length, 2);
    assert.ok(ranked.every((e) => e.costTier !== COST_TIER.EXPENSIVE));
  });

  it('excludes unavailable endpoints', () => {
    const withUnavailable = [
      { ...localEndpoint, available: false },
      cheapEndpoint,
      expensiveEndpoint,
    ];
    const ranked = rankEndpointsByCost(withUnavailable);
    assert.equal(ranked.length, 2);
    assert.ok(!ranked.some((e) => e.id === 'local-llama'));
  });

  it('returns empty for no available endpoints', () => {
    const none = endpoints.map((e) => ({ ...e, available: false }));
    assert.equal(rankEndpointsByCost(none).length, 0);
  });
});
