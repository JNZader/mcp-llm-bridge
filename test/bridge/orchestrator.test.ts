/**
 * Bridge orchestrator tests — routing, fallback, normalization.
 *
 * Uses mock Router to test bridge logic without real providers.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { BridgeOrchestrator } from '../../src/bridge/orchestrator.js';
import type { BridgeConfig } from '../../src/bridge/types.js';
import type { Router } from '../../src/core/router.js';
import type { GenerateRequest, GenerateResponse } from '../../src/core/types.js';

/** Create a mock Router with configurable generate behavior. */
function createMockRouter(
  generateFn: (request: GenerateRequest) => Promise<GenerateResponse>,
): Router {
  return { generate: generateFn } as unknown as Router;
}

/** Standard test config. */
function testConfig(): BridgeConfig {
  return {
    routes: new Map([
      ['large-context', 'gemini-cli'],
      ['code-review', 'claude-cli'],
      ['fast-completion', 'codex-cli'],
    ]),
    default: 'claude-cli',
    fallbackOrder: ['claude-cli', 'gemini-cli', 'codex-cli'],
  };
}

/** Create a successful response. */
function successResponse(provider: string): GenerateResponse {
  return {
    text: `response from ${provider}`,
    provider,
    model: `${provider}-model`,
    resolvedProvider: provider,
    resolvedModel: `${provider}-model`,
    fallbackUsed: false,
  };
}

// ── Routing ──────────────────────────────────────────────────

describe('BridgeOrchestrator routing', () => {
  it('routes code-review prompts to claude-cli', async () => {
    const generateFn = mock.fn(async (req: GenerateRequest) =>
      successResponse(req.provider ?? 'unknown'),
    );
    const router = createMockRouter(generateFn);
    const orchestrator = new BridgeOrchestrator(router, testConfig());

    const result = await orchestrator.generate({
      prompt: 'Review this code for security issues',
    });

    assert.equal(result.taskType, 'code-review');
    assert.equal(result.provider, 'claude-cli');
    assert.equal(result.fallbackUsed, false);
    assert.ok(result.latencyMs >= 0);
  });

  it('routes short prompts to codex-cli (fast-completion)', async () => {
    const generateFn = mock.fn(async (req: GenerateRequest) =>
      successResponse(req.provider ?? 'unknown'),
    );
    const router = createMockRouter(generateFn);
    const orchestrator = new BridgeOrchestrator(router, testConfig());

    const result = await orchestrator.generate({
      prompt: 'Fix this bug',
    });

    assert.equal(result.taskType, 'fast-completion');
    assert.equal(result.provider, 'codex-cli');
    assert.equal(result.fallbackUsed, false);
  });

  it('routes unmatched task types to default provider', async () => {
    const generateFn = mock.fn(async (req: GenerateRequest) =>
      successResponse(req.provider ?? 'unknown'),
    );
    const router = createMockRouter(generateFn);
    // Config with no routes — everything goes to default
    const config: BridgeConfig = {
      routes: new Map(),
      default: 'claude-cli',
      fallbackOrder: ['claude-cli', 'gemini-cli'],
    };
    const orchestrator = new BridgeOrchestrator(router, config);

    // Medium-length prompt without keywords → 'default' task type
    const prompt = 'Write a function that processes data and returns results in the expected format for our API endpoint that handles user requests. '.repeat(5);
    const result = await orchestrator.generate({ prompt });

    assert.equal(result.taskType, 'default');
    assert.equal(result.provider, 'claude-cli');
  });
});

// ── Fallback Chain ───────────────────────────────────────────

describe('BridgeOrchestrator fallback', () => {
  it('falls back to next provider when primary fails', async () => {
    let callCount = 0;
    const generateFn = mock.fn(async (req: GenerateRequest) => {
      callCount++;
      if (req.provider === 'codex-cli') {
        throw new Error('codex-cli unavailable');
      }
      return successResponse(req.provider ?? 'unknown');
    });
    const router = createMockRouter(generateFn);
    const orchestrator = new BridgeOrchestrator(router, testConfig());

    // Short prompt → fast-completion → codex-cli (primary)
    const result = await orchestrator.generate({ prompt: 'Hello' });

    assert.equal(result.taskType, 'fast-completion');
    assert.equal(result.fallbackUsed, true);
    // Should have tried codex-cli first, then fallen back to claude-cli
    assert.equal(result.provider, 'claude-cli');
    assert.ok(callCount >= 2);
  });

  it('throws when all fallback providers fail', async () => {
    const generateFn = mock.fn(async (_req: GenerateRequest) => {
      throw new Error('provider failed');
    });
    const router = createMockRouter(generateFn);
    const orchestrator = new BridgeOrchestrator(router, testConfig());

    await assert.rejects(
      () => orchestrator.generate({ prompt: 'Review this code' }),
      /Bridge: all providers failed/,
    );
  });

  it('deduplicates providers in fallback order', async () => {
    const calledProviders: string[] = [];
    const generateFn = mock.fn(async (req: GenerateRequest) => {
      calledProviders.push(req.provider ?? 'unknown');
      throw new Error('fail');
    });
    const router = createMockRouter(generateFn);

    // Config where preferred provider is also in fallback_order
    const config: BridgeConfig = {
      routes: new Map([['code-review', 'claude-cli']]),
      default: 'claude-cli',
      fallbackOrder: ['claude-cli', 'gemini-cli', 'codex-cli'],
    };
    const orchestrator = new BridgeOrchestrator(router, config);

    await assert.rejects(
      () => orchestrator.generate({ prompt: 'Review this' }),
    );

    // claude-cli should only appear once (not duplicated)
    const claudeCount = calledProviders.filter((p) => p === 'claude-cli').length;
    assert.equal(claudeCount, 1, 'claude-cli should be tried exactly once');
    assert.equal(calledProviders.length, 3, 'Should try 3 unique providers');
  });
});

// ── Response Normalization ───────────────────────────────────

describe('BridgeOrchestrator response normalization', () => {
  it('returns normalized BridgeResponse with all fields', async () => {
    const generateFn = mock.fn(async (req: GenerateRequest) => ({
      text: 'generated text',
      provider: req.provider ?? 'claude-cli',
      model: 'claude-sonnet-4-5',
      tokensUsed: 150,
      resolvedProvider: req.provider ?? 'claude-cli',
      resolvedModel: 'claude-sonnet-4-5',
      fallbackUsed: false,
    }));
    const router = createMockRouter(generateFn);
    const orchestrator = new BridgeOrchestrator(router, testConfig());

    const result = await orchestrator.generate({
      prompt: 'Audit this module for vulnerabilities',
    });

    assert.equal(result.text, 'generated text');
    assert.equal(result.provider, 'claude-cli');
    assert.equal(result.model, 'claude-sonnet-4-5');
    assert.equal(result.taskType, 'code-review');
    assert.equal(result.fallbackUsed, false);
    assert.equal(typeof result.latencyMs, 'number');
  });

  it('preserves original request fields when routing', async () => {
    const capturedRequest: GenerateRequest[] = [];
    const generateFn = mock.fn(async (req: GenerateRequest) => {
      capturedRequest.push(req);
      return successResponse(req.provider ?? 'unknown');
    });
    const router = createMockRouter(generateFn);
    const orchestrator = new BridgeOrchestrator(router, testConfig());

    await orchestrator.generate({
      prompt: 'Review this code',
      system: 'You are a code reviewer',
      maxTokens: 2048,
      project: 'my-project',
    });

    assert.equal(capturedRequest.length, 1);
    assert.equal(capturedRequest[0]!.system, 'You are a code reviewer');
    assert.equal(capturedRequest[0]!.maxTokens, 2048);
    assert.equal(capturedRequest[0]!.project, 'my-project');
    assert.equal(capturedRequest[0]!.provider, 'claude-cli');
  });
});
