/**
 * Tests for the flat vector index.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VectorIndex, VectorIndexEntry } from '../../src/code-search/vector-index.js';

function floatEqual(a: number, b: number, epsilon = 1e-10): boolean {
  return Math.abs(a - b) < epsilon;
}

describe('VectorIndex', () => {
  it('adds vectors and queries top K results', () => {
    const index = new VectorIndex();

    index.add('a', new Float32Array([1, 0, 0]));
    index.add('b', new Float32Array([0, 1, 0]));
    index.add('c', new Float32Array([0, 0, 1]));

    const top1 = index.query(new Float32Array([1, 0, 0]), 1);
    assert.equal(top1.length, 1);
    assert.equal(top1[0]!.id, 'a');
    assert.ok(floatEqual(top1[0]!.score, 1.0));

    const top2 = index.query(new Float32Array([1, 0, 0]), 2);
    assert.equal(top2.length, 2);
    assert.equal(top2[0]!.id, 'a');
    assert.ok(floatEqual(top2[0]!.score, 1.0));
    assert.equal(top2[1]!.id, 'b');
    assert.ok(floatEqual(top2[1]!.score, 0.5));
  });

  it('computes correct cosine similarity for known vectors', () => {
    const index = new VectorIndex();

    // Identical vectors → cosine 1 → normalized 1
    index.add('same', new Float32Array([1, 0, 0]));
    const sameResult = index.query(new Float32Array([1, 0, 0]), 1);
    assert.ok(floatEqual(sameResult[0]!.score, 1.0));

    // Orthogonal vectors → cosine 0 → normalized 0.5
    index.add('ortho', new Float32Array([0, 1, 0]));
    const orthoResult = index.query(new Float32Array([1, 0, 0]), 2);
    const ortho = orthoResult.find((r) => r.id === 'ortho');
    assert.ok(ortho !== undefined);
    assert.ok(floatEqual(ortho!.score, 0.5));

    // Opposite vectors → cosine -1 → normalized 0
    index.add('opp', new Float32Array([-1, 0, 0]));
    const oppResult = index.query(new Float32Array([1, 0, 0]), 3);
    const opp = oppResult.find((r) => r.id === 'opp');
    assert.ok(opp !== undefined);
    assert.ok(floatEqual(opp!.score, 0.0));
  });

  it('normalizes scores to [0,1]', () => {
    const index = new VectorIndex();

    index.add('pos', new Float32Array([1, 1, 1]));
    index.add('neg', new Float32Array([-1, -1, -1]));
    index.add('ortho', new Float32Array([1, -1, 0]));

    const results = index.query(new Float32Array([1, 1, 1]), 10);

    for (const r of results) {
      assert.ok(r.score >= 0, `Expected score >= 0, got ${r.score}`);
      assert.ok(r.score <= 1, `Expected score <= 1, got ${r.score}`);
    }

    // Positive match should be near 1
    const pos = results.find((r) => r.id === 'pos');
    assert.ok(pos !== undefined);
    assert.ok(floatEqual(pos!.score, 1.0));

    // Negative match should be near 0
    const neg = results.find((r) => r.id === 'neg');
    assert.ok(neg !== undefined);
    assert.ok(floatEqual(neg!.score, 0.0));
  });

  it('returns empty array for empty index', () => {
    const index = new VectorIndex();
    const results = index.query(new Float32Array([1, 0, 0]), 5);
    assert.equal(results.length, 0);
  });

  it('returns all results sorted when topK > size', () => {
    const index = new VectorIndex();

    index.add('z', new Float32Array([0, 0, 1]));
    index.add('x', new Float32Array([1, 0, 0]));
    index.add('y', new Float32Array([0, 1, 0]));

    const results = index.query(new Float32Array([1, 0, 0]), 100);
    assert.equal(results.length, 3);
    assert.equal(results[0]!.id, 'x');
    assert.equal(results[1]!.id, 'y');
    assert.equal(results[2]!.id, 'z');

    // Verify descending scores
    assert.ok(results[0]!.score >= results[1]!.score);
    assert.ok(results[1]!.score >= results[2]!.score);
  });

  it('overwrites duplicate IDs', () => {
    const index = new VectorIndex();

    index.add('dup', new Float32Array([1, 0, 0]));
    index.add('dup', new Float32Array([0, 1, 0]));

    assert.equal(index.size(), 1);

    const results = index.query(new Float32Array([0, 1, 0]), 1);
    assert.equal(results[0]!.id, 'dup');
    assert.ok(floatEqual(results[0]!.score, 1.0));
  });

  it('clears all vectors', () => {
    const index = new VectorIndex();

    index.add('a', new Float32Array([1, 0, 0]));
    index.add('b', new Float32Array([0, 1, 0]));
    assert.equal(index.size(), 2);

    index.clear();
    assert.equal(index.size(), 0);
    assert.equal(index.query(new Float32Array([1, 0, 0]), 5).length, 0);
  });

  it('handles zero vector queries', () => {
    const index = new VectorIndex();

    index.add('a', new Float32Array([1, 0, 0]));
    const zeroQuery = index.query(new Float32Array([0, 0, 0]), 1);
    assert.equal(zeroQuery.length, 1);
    assert.equal(zeroQuery[0]!.id, 'a');
    assert.ok(floatEqual(zeroQuery[0]!.score, 0.0));

    // Zero vector in index
    index.add('zero', new Float32Array([0, 0, 0]));
    const results = index.query(new Float32Array([1, 0, 0]), 2);
    const zeroResult = results.find((r) => r.id === 'zero');
    assert.ok(zeroResult !== undefined);
    assert.ok(floatEqual(zeroResult!.score, 0.0));
  });

  it('queries 1000 vectors in under 100ms', () => {
    const index = new VectorIndex();
    const dim = 384;
    const count = 1000;

    // Generate random unit-ish vectors
    for (let i = 0; i < count; i++) {
      const vec = new Float32Array(dim);
      for (let d = 0; d < dim; d++) {
        vec[d] = Math.random() * 2 - 1;
      }
      index.add(`vec-${i}`, vec);
    }

    const queryVec = new Float32Array(dim);
    for (let d = 0; d < dim; d++) {
      queryVec[d] = Math.random() * 2 - 1;
    }

    const start = performance.now();
    const results = index.query(queryVec, 10);
    const elapsed = performance.now() - start;

    assert.equal(results.length, 10);
    assert.ok(elapsed < 100, `Expected query < 100ms, got ${elapsed.toFixed(2)}ms`);
  });
});

describe('VectorIndexEntry interface', () => {
  it('can be instantiated as a plain object', () => {
    const entry: VectorIndexEntry = {
      id: 'test',
      vector: new Float32Array([1, 2, 3]),
    };
    assert.equal(entry.id, 'test');
    assert.deepEqual(entry.vector, new Float32Array([1, 2, 3]));
  });
});
