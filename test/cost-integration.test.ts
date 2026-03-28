/**
 * Cost tracking integration test — router → cost recorded → query returns it.
 *
 * Verifies the full flow: Router.generate() with cost tracker attached
 * records usage that can be queried back.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Router } from '../src/core/router.js';
import { CostTracker } from '../src/core/cost-tracker.js';
import type { LLMProvider, GenerateRequest, GenerateResponse, ModelInfo } from '../src/core/types.js';

/** Create a temp dir and return a db path inside it. */
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cost-integration-test-'));
  return join(dir, 'test.db');
}

/** Create a mock provider that returns successfully. */
function createMockProvider(id: string, model: string): LLMProvider {
  return {
    id,
    name: id,
    type: 'api' as const,
    models: [{ id: model, name: model, provider: id } as ModelInfo],
    isAvailable: async () => true,
    generate: async (_req: GenerateRequest): Promise<GenerateResponse> => ({
      text: 'mock response',
      provider: id,
      model,
      tokensUsed: 150,
      resolvedProvider: id,
      resolvedModel: model,
      fallbackUsed: false,
    }),
  };
}

/** Create a mock provider that always fails. */
function createFailingProvider(id: string, model: string): LLMProvider {
  return {
    id,
    name: id,
    type: 'api' as const,
    models: [{ id: model, name: model, provider: id } as ModelInfo],
    isAvailable: async () => true,
    generate: async (): Promise<GenerateResponse> => {
      throw new Error('Provider unavailable');
    },
  };
}

describe('Cost tracking integration', () => {
  let tracker: CostTracker;
  let dbPath: string;

  afterEach(() => {
    if (tracker) {
      try { tracker.destroy(); } catch { /* already destroyed */ }
    }
    if (dbPath) {
      try { rmSync(dbPath, { force: true }); } catch { /* ok */ }
      try { rmSync(dbPath + '-wal', { force: true }); } catch { /* ok */ }
      try { rmSync(dbPath + '-shm', { force: true }); } catch { /* ok */ }
    }
  });

  it('records usage after successful generate()', async () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    const router = new Router();
    router.setCostTracker(tracker);
    router.register(createMockProvider('openai', 'gpt-4o'));

    await router.generate({
      prompt: 'Hello',
      model: 'gpt-4o',
    });

    // Flush the buffer
    tracker.flush();

    const records = tracker.query();
    assert.equal(records.length, 1);
    assert.equal(records[0]!.provider, 'openai');
    assert.equal(records[0]!.model, 'gpt-4o');
    assert.equal(records[0]!.success, true);
    assert.ok(records[0]!.latencyMs >= 0);
  });

  it('records usage after failed generate()', async () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    const router = new Router();
    router.setCostTracker(tracker);
    router.register(createFailingProvider('openai', 'gpt-4o'));

    try {
      await router.generate({ prompt: 'Hello', model: 'gpt-4o' });
      assert.fail('should have thrown');
    } catch {
      // expected
    }

    tracker.flush();

    const records = tracker.query();
    assert.equal(records.length, 1);
    assert.equal(records[0]!.success, false);
    assert.ok(records[0]!.errorMessage);
  });

  it('records correct model from response (not request)', async () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    const router = new Router();
    router.setCostTracker(tracker);

    // Provider that returns a different model than requested
    const provider: LLMProvider = {
      id: 'openai',
      name: 'openai',
      type: 'api',
      models: [{ id: 'gpt-4o', name: 'gpt-4o', provider: 'openai' } as ModelInfo],
      isAvailable: async () => true,
      generate: async (): Promise<GenerateResponse> => ({
        text: 'response',
        provider: 'openai',
        model: 'gpt-4o-2024-08-06',
        tokensUsed: 100,
        resolvedProvider: 'openai',
        resolvedModel: 'gpt-4o-2024-08-06',
        fallbackUsed: false,
      }),
    };

    router.register(provider);

    await router.generate({ prompt: 'test', model: 'gpt-4o' });
    tracker.flush();

    const records = tracker.query();
    assert.equal(records[0]!.model, 'gpt-4o-2024-08-06');
  });

  it('summary aggregates across multiple requests', async () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    const router = new Router();
    router.setCostTracker(tracker);
    router.register(createMockProvider('openai', 'gpt-4o'));

    // Make 3 requests
    for (let i = 0; i < 3; i++) {
      await router.generate({ prompt: `request ${i}`, model: 'gpt-4o' });
    }

    tracker.flush();

    const summary = tracker.summary();
    assert.equal(summary.totalRequests, 3);
    assert.ok(summary.totalTokensIn >= 0);
  });
});
