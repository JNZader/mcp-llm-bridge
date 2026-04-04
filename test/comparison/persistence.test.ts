/**
 * Tests for ComparisonStore persistence layer.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';

import { ComparisonStore } from '../../src/comparison/persistence.js';
import type { CompareResponse } from '../../src/comparison/index.js';

function createTestDb(): { db: Database.Database; path: string } {
  const path = join(tmpdir(), `mlb-comparison-test-${randomUUID()}.db`);
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  return { db, path };
}

function makeCompareResponse(overrides: Partial<CompareResponse> = {}): CompareResponse {
  return {
    id: randomUUID(),
    prompt: 'What is 2+2?',
    results: [
      {
        model: 'gpt-4',
        provider: 'openai',
        status: 'success',
        response: 'The answer is 4.',
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0.001,
        latencyMs: 300,
        finishReason: 'stop',
      },
      {
        model: 'claude-3-opus',
        provider: 'anthropic',
        status: 'success',
        response: '4',
        tokensIn: 8,
        tokensOut: 2,
        costUsd: 0.0005,
        latencyMs: 200,
        finishReason: 'stop',
      },
    ],
    summary: {
      fastestModel: 'claude-3-opus',
      cheapestModel: 'claude-3-opus',
      totalCost: 0.0015,
      wallClockMs: 300,
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ComparisonStore', () => {
  let db: Database.Database;
  let dbPath: string;
  let store: ComparisonStore;

  beforeEach(() => {
    const result = createTestDb();
    db = result.db;
    dbPath = result.path;
    store = new ComparisonStore(db);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch { /* ignore */ }
    try { unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('save + query round-trip', () => {
    const response = makeCompareResponse();
    store.save(response, 'system prompt', ['gpt-4', 'claude-3-opus']);

    const results = store.query();
    assert.equal(results.length, 1);
    assert.equal(results[0]!.id, response.id);
    assert.equal(results[0]!.prompt, response.prompt);
    assert.equal(results[0]!.results.length, 2);
    assert.equal(results[0]!.summary.totalCost, response.summary.totalCost);
  });

  it('getById returns the saved comparison', () => {
    const response = makeCompareResponse();
    store.save(response);

    const found = store.getById(response.id);
    assert.ok(found !== null);
    assert.equal(found!.id, response.id);
    assert.equal(found!.prompt, response.prompt);
  });

  it('getById returns null for unknown id', () => {
    const found = store.getById(randomUUID());
    assert.equal(found, null);
  });

  it('project filtering — only returns matching project', () => {
    const r1 = makeCompareResponse({ id: randomUUID() });
    const r2 = makeCompareResponse({ id: randomUUID() });

    store.save(r1, undefined, undefined, 'project-a');
    store.save(r2, undefined, undefined, 'project-b');

    const projectA = store.query({ project: 'project-a' });
    assert.equal(projectA.length, 1);
    assert.equal(projectA[0]!.id, r1.id);

    const projectB = store.query({ project: 'project-b' });
    assert.equal(projectB.length, 1);
    assert.equal(projectB[0]!.id, r2.id);
  });

  it('limit pagination — respects limit', () => {
    for (let i = 0; i < 5; i++) {
      store.save(makeCompareResponse({ id: randomUUID() }));
    }

    const limited = store.query({ limit: 3 });
    assert.equal(limited.length, 3);
  });

  it('offset pagination — skips first N results', () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = randomUUID();
      ids.push(id);
      // slight delay to ensure distinct created_at ordering
      store.save(makeCompareResponse({ id, createdAt: new Date(Date.now() - (3 - i) * 1000).toISOString() }));
    }

    const all = store.query({ limit: 10 });
    assert.equal(all.length, 4);

    const page2 = store.query({ limit: 2, offset: 2 });
    assert.equal(page2.length, 2);
    // page2 results should be different from first 2
    const firstPage = store.query({ limit: 2, offset: 0 });
    assert.notEqual(page2[0]!.id, firstPage[0]!.id);
  });

  it('empty results — returns empty array', () => {
    const results = store.query();
    assert.equal(results.length, 0);

    const filtered = store.query({ project: 'nonexistent' });
    assert.equal(filtered.length, 0);
  });

  it('limit is capped at 100', () => {
    for (let i = 0; i < 5; i++) {
      store.save(makeCompareResponse({ id: randomUUID() }));
    }
    // limit=200 should be silently capped to 100
    const results = store.query({ limit: 200 });
    assert.ok(results.length <= 100);
    assert.equal(results.length, 5); // only 5 records exist
  });
});
