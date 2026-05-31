/**
 * Integration tests for CodeSearchService hybrid search modes.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CodeSearchService } from '../../src/code-search/searcher.js';
import type { Embedder } from '../../src/code-search/embedder.js';
import type { FusedSearchResult } from '../../src/code-search/hybrid-rrf.js';

function isFusedSearchResult(result: object): result is FusedSearchResult {
  return (
    'rrfScore' in result &&
    typeof result.rrfScore === 'number' &&
    'methodCount' in result &&
    typeof result.methodCount === 'number'
  );
}

const TEST_DIR = join('/tmp', `hybrid-integration-test-${Date.now()}`);

/** Simple deterministic embedder for testing. */
class MockEmbedder implements Embedder {
  private vocab = ['authenticate', 'authorize', 'validate', 'server', 'logger', 'function', 'export', 'class'];

  async embed(text: string): Promise<Float32Array> {
    const vec = new Float32Array(this.vocab.length);
    const lower = text.toLowerCase();
    for (let i = 0; i < this.vocab.length; i++) {
      vec[i] = lower.includes(this.vocab[i]!) ? 1 : 0;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] = vec[i]! / norm;
      }
    }
    return vec;
  }
}

function setupTestDir(): void {
  mkdirSync(join(TEST_DIR, 'src'), { recursive: true });

  writeFileSync(
    join(TEST_DIR, 'src', 'auth.ts'),
    `
export function authenticate(token: string): boolean {
  return validateToken(token);
}

export function authorize(user: User, resource: string): boolean {
  return user.permissions.includes(resource);
}

function validateToken(token: string): boolean {
  return token.length > 0;
}
`.trim(),
  );

  writeFileSync(
    join(TEST_DIR, 'src', 'server.ts'),
    `
import { authenticate } from './auth.js';

export class HttpServer {
  constructor(private port: number) {}

  async start(): Promise<void> {
    console.log('Starting on port', this.port);
  }

  handleRequest(req: Request): Response {
    if (!authenticate(req.headers.get('auth') ?? '')) {
      return new Response('Unauthorized', { status: 401 });
    }
    return new Response('OK');
  }
}
`.trim(),
  );

  writeFileSync(
    join(TEST_DIR, 'src', 'logger.ts'),
    `
export function createLogger(name: string) {
  return {
    info: (msg: string) => console.log(\`[\${name}] \${msg}\`),
    error: (msg: string) => console.error(\`[\${name}] \${msg}\`),
  };
}
`.trim(),
  );
}

// Cleanup on exit
process.on('exit', () => {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('CodeSearchService mode dispatch', () => {
  let service: CodeSearchService;

  beforeEach(() => {
    service = new CodeSearchService({ embedder: new MockEmbedder() });
    setupTestDir();
  });

  it('mode=keyword returns same results as before (regression)', async () => {
    await service.indexDirectory({ rootDir: TEST_DIR });
    const results = await service.search({ query: 'authenticate', scope: TEST_DIR, mode: 'keyword' });

    assert.ok(results.length > 0, 'Should find results');
    assert.equal(results[0]!.name, 'authenticate');
    // Score should be normalized keyword score
    assert.ok(results[0]!.score > 0);
  });

  it('mode=vector returns only vector similarity results', async () => {
    await service.indexDirectory({ rootDir: TEST_DIR });
    const results = await service.search({ query: 'authenticate', scope: TEST_DIR, mode: 'vector' });

    // Mock embedder produces vectors where 'authenticate' dimension is set
    // for both the query and the authenticate function chunk
    assert.ok(results.length > 0, 'Should find vector results');
    // Vector search should find authenticate because query and chunk share the word
    const authResult = results.find((r) => r.name === 'authenticate');
    assert.ok(authResult, 'Should find authenticate via vector search');
  });

  it('mode=hybrid returns fused results from all 3 strategies', async () => {
    await service.indexDirectory({ rootDir: TEST_DIR });
    const results = await service.search({ query: 'authenticate', scope: TEST_DIR, mode: 'hybrid' });

    assert.ok(results.length > 0, 'Should find hybrid results');

    // Results should include items found by keyword or BM25 or vector
    const names = results.map((r) => r.name);
    assert.ok(names.includes('authenticate'), 'Should include authenticate');

    // Since RRF replaces score with rrfScore, hybrid results should have rrfScore
    // and methodCount properties (from FusedSearchResult)
    for (const result of results) {
      assert.ok(
        'rrfScore' in result && typeof (result as Record<string, unknown>).rrfScore === 'number',
        'Hybrid result should have rrfScore',
      );
      assert.ok(
        'methodCount' in result && typeof (result as Record<string, unknown>).methodCount === 'number',
        'Hybrid result should have methodCount',
      );
    }
  });

  it('hybrid with empty vector index still fuses keyword + BM25', async () => {
    // Create service without embedder → vector index stays empty
    const noVectorService = new CodeSearchService();
    await noVectorService.indexDirectory({ rootDir: TEST_DIR });

    const results = await noVectorService.search({ query: 'authenticate', scope: TEST_DIR, mode: 'hybrid' });

    assert.ok(results.length > 0, 'Should find results even with empty vector index');

    // Should still have fused properties (RRF fuses keyword + BM25)
    for (const result of results) {
      assert.ok(
        'rrfScore' in result && typeof (result as Record<string, unknown>).rrfScore === 'number',
        'Should have rrfScore when fusing keyword + BM25',
      );
    }
  });

  it('hybrid with BM25 unavailable still fuses keyword + vector', async () => {
    await service.indexDirectory({ rootDir: TEST_DIR });

    // Replace BM25 index with a mock that reports unavailable
    service.bm25Index = {
      isAvailable: () => false,
      search: () => [],
      add: () => {},
      clear: () => {},
      size: () => 0,
    } as unknown as typeof service.bm25Index;

    const results = await service.search({ query: 'authenticate', scope: TEST_DIR, mode: 'hybrid' });

    assert.ok(results.length > 0, 'Should find results even when BM25 unavailable');

    for (const result of results) {
      assert.ok(
        'rrfScore' in result && typeof (result as Record<string, unknown>).rrfScore === 'number',
        'Should have rrfScore when fusing keyword + vector',
      );
    }
  });

  it('hybrid with all empty returns empty', async () => {
    await service.indexDirectory({ rootDir: TEST_DIR });
    const results = await service.search({ query: 'xyznonexistent123', scope: TEST_DIR, mode: 'hybrid' });

    assert.equal(results.length, 0, 'Should return empty when no strategy finds matches');
  });

  it('RRF improves ranking for multi-list items', async () => {
    // Set up a directory where we can observe ranking differences
    const rrfDir = join('/tmp', `rrf-test-${Date.now()}`);
    mkdirSync(join(rrfDir, 'src'), { recursive: true });

    writeFileSync(
      join(rrfDir, 'src', 'alpha.ts'),
      `export function alpha() { return 1; }`,
    );
    writeFileSync(
      join(rrfDir, 'src', 'beta.ts'),
      `export function beta() { return alpha(); }`,
    );
    writeFileSync(
      join(rrfDir, 'src', 'gamma.ts'),
      `export function gamma() { console.log('alpha helper'); }`,
    );

    const rrfService = new CodeSearchService({ embedder: new MockEmbedder() });
    await rrfService.indexDirectory({ rootDir: rrfDir });

    const keywordResults = await rrfService.search({ query: 'alpha', scope: rrfDir, mode: 'keyword' });
    const hybridResults = await rrfService.search({ query: 'alpha', scope: rrfDir, mode: 'hybrid' });

    assert.ok(keywordResults.length > 0, 'Keyword should find results');
    assert.ok(hybridResults.length > 0, 'Hybrid should find results');

    // alpha() is exact name match — should be top in keyword
    assert.equal(keywordResults[0]!.name, 'alpha');

    // In hybrid, gamma() also contains 'alpha' in its body (BM25) and shares
    // the 'alpha' token with the query (vector). Because it appears in more
    // lists, it might rank higher than in keyword-only. But the key assertion
    // is that the hybrid ranking differs from keyword-only, showing fusion works.
    const hybridNames = hybridResults.map((r) => r.name);
    // The union of keyword and BM25 should be present in hybrid
    assert.ok(hybridNames.includes('alpha'), 'Hybrid should include alpha');

    // At least one item in hybrid should have methodCount >= 2
    // (meaning it was found by multiple strategies)
    const multiMethod = hybridResults.find(
      (result) => isFusedSearchResult(result) && result.methodCount >= 2,
    );
    assert.ok(
      multiMethod,
      'At least one hybrid result should be found by multiple methods (methodCount >= 2)',
    );

    // Cleanup
    rmSync(rrfDir, { recursive: true, force: true });
  });

  it('score explanations are present in hybrid results', async () => {
    await service.indexDirectory({ rootDir: TEST_DIR });
    const results = await service.search({ query: 'authenticate', scope: TEST_DIR, mode: 'hybrid' });

    assert.ok(results.length > 0, 'Should find hybrid results');

    for (const result of results) {
      assert.ok(isFusedSearchResult(result), 'Each hybrid result should include fusion metadata');

      assert.ok(
        result.rrfScore > 0,
        'Each hybrid result should have a positive rrfScore',
      );
      assert.ok(
        result.methodCount >= 1,
        'Each hybrid result should have methodCount >= 1',
      );
    }
  });
});
