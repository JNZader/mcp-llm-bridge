/**
 * Tests for the in-memory search index.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SearchIndex, HybridIndex } from '../../src/code-search/indexer.js';
import type { CodeChunk } from '../../src/code-search/types.js';
import type { Embedder } from '../../src/code-search/embedder.js';

function makeChunk(overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    id: overrides.id ?? 'test.ts:1',
    filePath: overrides.filePath ?? 'test.ts',
    name: overrides.name ?? 'testFunction',
    kind: overrides.kind ?? 'function',
    content: overrides.content ?? 'function testFunction() { return true; }',
    startLine: overrides.startLine ?? 1,
    endLine: overrides.endLine ?? 1,
  };
}

describe('SearchIndex', () => {
  let index: SearchIndex;

  beforeEach(() => {
    index = new SearchIndex();
  });

  it('starts empty', () => {
    assert.equal(index.size, 0);
  });

  it('adds chunks and tracks size', () => {
    index.addChunks([makeChunk(), makeChunk({ id: 'test.ts:5', name: 'other' })]);
    assert.equal(index.size, 2);
  });

  it('clears all data', () => {
    index.addChunks([makeChunk()]);
    index.clear();
    assert.equal(index.size, 0);
  });

  it('finds exact name matches with highest score', () => {
    index.addChunks([
      makeChunk({ name: 'authenticate' }),
      makeChunk({ id: 'test.ts:10', name: 'authorize' }),
      makeChunk({ id: 'test.ts:20', name: 'logout' }),
    ]);

    const results = index.search('authenticate', 10);
    assert.ok(results.length > 0, 'Should find results');
    assert.equal(results[0]!.name, 'authenticate');
    assert.equal(results[0]!.score, 1); // Normalized to 1
  });

  it('finds keyword matches in content', () => {
    index.addChunks([
      makeChunk({
        name: 'processData',
        content: 'function processData() { validate(input); transform(data); }',
      }),
      makeChunk({
        id: 'test.ts:10',
        name: 'other',
        content: 'function other() { return null; }',
      }),
    ]);

    const results = index.search('validate', 10);
    assert.ok(results.length > 0, 'Should find results with content match');
    assert.equal(results[0]!.name, 'processData');
  });

  it('supports fuzzy matching via trigrams', () => {
    index.addChunks([
      makeChunk({ name: 'authentication' }),
      makeChunk({ id: 'test.ts:10', name: 'unrelatedFunction' }),
    ]);

    // "authenticat" is close to "authentication" - should fuzzy match
    const results = index.search('authenticat', 10);
    assert.ok(results.length > 0, 'Should find fuzzy match');
    assert.equal(results[0]!.name, 'authentication');
  });

  it('returns empty for empty query', () => {
    index.addChunks([makeChunk()]);
    const results = index.search('', 10);
    assert.equal(results.length, 0);
  });

  it('returns empty for empty index', () => {
    const results = index.search('anything', 10);
    assert.equal(results.length, 0);
  });

  it('respects limit parameter', () => {
    const chunks = Array.from({ length: 20 }, (_, i) =>
      makeChunk({
        id: `test.ts:${i + 1}`,
        name: `handler${i}`,
        content: `function handler${i}() { process(); }`,
      }),
    );
    index.addChunks(chunks);

    const results = index.search('handler', 5);
    assert.equal(results.length, 5);
  });

  it('ranks name matches higher than content matches', () => {
    index.addChunks([
      makeChunk({
        name: 'unrelated',
        content: 'function unrelated() { authenticate(); }',
      }),
      makeChunk({
        id: 'test.ts:10',
        name: 'authenticate',
        content: 'function authenticate() { return true; }',
      }),
    ]);

    const results = index.search('authenticate', 10);
    assert.ok(results.length >= 2, 'Should find both');
    assert.equal(results[0]!.name, 'authenticate', 'Name match should rank first');
  });

  it('returns scores between 0 and 1', () => {
    index.addChunks([
      makeChunk({ name: 'exact' }),
      makeChunk({ id: 'test.ts:10', name: 'similar' }),
    ]);

    const results = index.search('exact', 10);
    for (const r of results) {
      assert.ok(r.score >= 0 && r.score <= 1, `Score ${r.score} should be 0-1`);
    }
  });

  it('getChunk returns chunk by ID', () => {
    const chunk = makeChunk({ id: 'myfile.ts:42' });
    index.addChunks([chunk]);

    const found = index.getChunk('myfile.ts:42');
    assert.ok(found, 'Should find chunk by ID');
    assert.equal(found.name, 'testFunction');
  });

  it('getChunksForFile returns all chunks in a file', () => {
    index.addChunks([
      makeChunk({ filePath: 'a.ts', id: 'a.ts:1' }),
      makeChunk({ filePath: 'a.ts', id: 'a.ts:10', name: 'second' }),
      makeChunk({ filePath: 'b.ts', id: 'b.ts:1', name: 'other' }),
    ]);

    const aChunks = index.getChunksForFile('a.ts');
    assert.equal(aChunks.length, 2);

    const bChunks = index.getChunksForFile('b.ts');
    assert.equal(bChunks.length, 1);
  });
});

/** Mock embedder that returns deterministic 384-dim vectors. */
function createMockEmbedder(): Embedder {
  return {
    async embed(text: string): Promise<Float32Array> {
      // Deterministic pseudo-random vector based on text length
      const vec = new Float32Array(384);
      for (let i = 0; i < 384; i++) {
        vec[i] = Math.sin(text.length * 0.1 + i * 0.05) + 0.5;
      }
      return vec;
    },
  };
}

describe('HybridIndex', () => {
  let index: HybridIndex;

  beforeEach(() => {
    index = new HybridIndex();
  });

  it('starts empty', () => {
    assert.equal(index.size, 0);
    assert.equal(index.indexSizes.keyword, 0);
    assert.equal(index.indexSizes.bm25, 0);
    assert.equal(index.indexSizes.vector, 0);
    assert.equal(index.hasVectorIndex, false);
  });

  it('adds chunks to keyword and BM25 indices without embedder', async () => {
    await index.addChunks([
      makeChunk({ id: 'a.ts:1', name: 'foo', content: 'function foo() {}' }),
      makeChunk({ id: 'a.ts:5', name: 'bar', content: 'function bar() {}' }),
    ]);

    assert.equal(index.size, 2);
    assert.equal(index.indexSizes.keyword, 2);
    assert.equal(index.indexSizes.bm25, 2);
    assert.equal(index.indexSizes.vector, 0);
    assert.equal(index.hasVectorIndex, false);
  });

  it('adds chunks to all 3 indices with embedder', async () => {
    const embedder = createMockEmbedder();
    index = new HybridIndex(embedder);

    await index.addChunks([
      makeChunk({ id: 'a.ts:1', name: 'foo', content: 'function foo() {}' }),
      makeChunk({ id: 'a.ts:5', name: 'bar', content: 'function bar() {}' }),
    ]);

    assert.equal(index.size, 2);
    assert.equal(index.indexSizes.keyword, 2);
    assert.equal(index.indexSizes.bm25, 2);
    assert.equal(index.indexSizes.vector, 2);
    assert.equal(index.hasVectorIndex, true);
  });

  it('keyword search still works (regression)', async () => {
    await index.addChunks([
      makeChunk({ name: 'authenticate' }),
      makeChunk({ id: 'test.ts:10', name: 'authorize' }),
    ]);

    const results = index.search('authenticate', 10);
    assert.ok(results.length > 0, 'Should find results');
    assert.equal(results[0]!.name, 'authenticate');
  });

  it('BM25 index is queryable after indexing', async () => {
    await index.addChunks([
      makeChunk({ name: 'processData', content: 'function processData() { validate(input); }' }),
      makeChunk({ id: 'test.ts:10', name: 'other', content: 'function other() { return null; }' }),
    ]);

    const results = index.bm25Index.search('validate', 10);
    assert.ok(results.length > 0, 'BM25 should find content match');
    assert.equal(results[0]!.id, 'test.ts:1');
  });

  it('vector index stores 384-dim embeddings', async () => {
    const embedder = createMockEmbedder();
    index = new HybridIndex(embedder);

    await index.addChunks([
      makeChunk({ id: 'a.ts:1', name: 'foo', content: 'function foo() {}' }),
    ]);

    assert.equal(index.vectorIndex.size(), 1);

    // Query with the same deterministic vector to verify storage
    const queryVec = await embedder.embed('function foo() {}');
    const results = index.vectorIndex.query(queryVec, 5);
    assert.ok(results.length > 0, 'Vector query should return results');
    assert.equal(results[0]!.id, 'a.ts:1');
  });

  it('clears all sub-indices', async () => {
    const embedder = createMockEmbedder();
    index = new HybridIndex(embedder);

    await index.addChunks([makeChunk()]);
    assert.equal(index.size, 1);

    index.clear();
    assert.equal(index.size, 0);
    assert.equal(index.indexSizes.bm25, 0);
    assert.equal(index.indexSizes.vector, 0);
  });

  it('getChunk delegates to keyword index', async () => {
    const chunk = makeChunk({ id: 'myfile.ts:42' });
    await index.addChunks([chunk]);

    const found = index.getChunk('myfile.ts:42');
    assert.ok(found, 'Should find chunk by ID');
    assert.equal(found.name, 'testFunction');
  });

  it('getChunksForFile delegates to keyword index', async () => {
    await index.addChunks([
      makeChunk({ filePath: 'a.ts', id: 'a.ts:1' }),
      makeChunk({ filePath: 'a.ts', id: 'a.ts:10', name: 'second' }),
    ]);

    const aChunks = index.getChunksForFile('a.ts');
    assert.equal(aChunks.length, 2);
  });
});
