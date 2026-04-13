/**
 * Hybrid search with Reciprocal Rank Fusion (RRF) — tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  reciprocalRankFusion,
  fuseSearchResults,
  explainRRFScore,
} from '../../src/code-search/hybrid-rrf.js';
import type { SearchResult } from '../../src/code-search/types.js';

describe('reciprocalRankFusion', () => {
  it('returns empty for empty input', () => {
    const result = reciprocalRankFusion([]);
    assert.equal(result.length, 0);
  });

  it('returns empty for empty lists', () => {
    const result = reciprocalRankFusion([[], []]);
    assert.equal(result.length, 0);
  });

  it('fuses two ranked lists', () => {
    const keyword = ['doc-a', 'doc-b', 'doc-c'];
    const vector = ['doc-b', 'doc-d', 'doc-a'];

    const results = reciprocalRankFusion([keyword, vector]);

    // doc-a and doc-b appear in both lists — should rank highest
    assert.ok(results.length > 0);

    const topKeys = results.slice(0, 2).map((r) => r.key);
    assert.ok(topKeys.includes('doc-a'), 'doc-a should be in top 2');
    assert.ok(topKeys.includes('doc-b'), 'doc-b should be in top 2');
  });

  it('items in multiple lists score higher than single-list items', () => {
    const list1 = ['shared', 'only-1'];
    const list2 = ['shared', 'only-2'];

    const results = reciprocalRankFusion([list1, list2]);

    assert.equal(results[0]!.key, 'shared');
    assert.equal(results[0]!.listCount, 2);
    assert.ok(results[0]!.rrfScore > results[1]!.rrfScore);
  });

  it('uses k parameter for dampening', () => {
    const list = ['a', 'b', 'c'];

    // Low k = more weight to top results
    const lowK = reciprocalRankFusion([list], { k: 1 });
    // High k = more uniform weights
    const highK = reciprocalRankFusion([list], { k: 100 });

    // With low k, the gap between rank 1 and rank 3 should be larger
    const lowKGap = lowK[0]!.rrfScore - lowK[2]!.rrfScore;
    const highKGap = highK[0]!.rrfScore - highK[2]!.rrfScore;

    assert.ok(lowKGap > highKGap, 'Low k should create larger score gaps');
  });

  it('respects limit option', () => {
    const list1 = ['a', 'b', 'c', 'd', 'e'];
    const list2 = ['e', 'd', 'c', 'b', 'a'];

    const results = reciprocalRankFusion([list1, list2], { limit: 3 });
    assert.equal(results.length, 3);
  });

  it('respects minScore threshold', () => {
    const list = ['a', 'b', 'c'];

    // With default k=60, score for rank 1 = 1/61 ≈ 0.0164
    const results = reciprocalRankFusion([list], { minScore: 0.016 });
    // Only the top result should pass this threshold
    assert.ok(results.length <= 2);
  });

  it('applies weights to lists', () => {
    const list1 = ['a', 'b'];
    const list2 = ['b', 'a'];

    // Weight list1 3x more than list2
    const results = reciprocalRankFusion([list1, list2], { weights: [3, 1] });

    // 'a' gets 3 * 1/61 + 1 * 1/62, 'b' gets 3 * 1/62 + 1 * 1/61
    // So 'a' should rank first due to higher weight on list1
    assert.equal(results[0]!.key, 'a');
  });

  it('tracks ranks per list', () => {
    const list1 = ['x', 'y'];
    const list2 = ['y', 'z'];

    const results = reciprocalRankFusion([list1, list2]);

    const xResult = results.find((r) => r.key === 'x')!;
    assert.equal(xResult.ranks[0], 0);  // rank 0 in list1
    assert.equal(xResult.ranks[1], -1); // not in list2

    const yResult = results.find((r) => r.key === 'y')!;
    assert.equal(yResult.ranks[0], 1);  // rank 1 in list1
    assert.equal(yResult.ranks[1], 0);  // rank 0 in list2
  });

  it('handles three or more lists', () => {
    const list1 = ['a', 'b', 'c'];
    const list2 = ['b', 'c', 'd'];
    const list3 = ['c', 'a', 'e'];

    const results = reciprocalRankFusion([list1, list2, list3]);

    // 'c' appears in all 3 lists — should rank highest
    const cResult = results.find((r) => r.key === 'c')!;
    assert.equal(cResult.listCount, 3);
    assert.equal(results[0]!.key, 'c');
  });
});

describe('fuseSearchResults', () => {
  function makeResult(name: string, startLine: number, score: number): SearchResult {
    return {
      filePath: 'test.ts',
      name,
      kind: 'function',
      content: `function ${name}() {}`,
      startLine,
      endLine: startLine + 1,
      score,
    };
  }

  it('returns empty for empty input', () => {
    const results = fuseSearchResults([]);
    assert.equal(results.length, 0);
  });

  it('fuses two SearchResult arrays', () => {
    const keyword: SearchResult[] = [
      makeResult('authenticate', 1, 0.9),
      makeResult('authorize', 5, 0.7),
    ];
    const fuzzy: SearchResult[] = [
      makeResult('authorize', 5, 0.8),
      makeResult('validate', 10, 0.6),
    ];

    const fused = fuseSearchResults([keyword, fuzzy]);

    assert.ok(fused.length > 0);
    // authorize is in both lists and should have methodCount 2
    const authzResult = fused.find((r) => r.name === 'authorize');
    assert.ok(authzResult);
    assert.equal(authzResult.methodCount, 2);
  });

  it('preserves original SearchResult fields', () => {
    const list1: SearchResult[] = [makeResult('myFunc', 42, 0.95)];

    const fused = fuseSearchResults([list1]);

    assert.equal(fused[0]!.filePath, 'test.ts');
    assert.equal(fused[0]!.name, 'myFunc');
    assert.equal(fused[0]!.kind, 'function');
    assert.equal(fused[0]!.startLine, 42);
    assert.ok(fused[0]!.rrfScore > 0);
  });

  it('respects limit', () => {
    const list1: SearchResult[] = Array.from({ length: 20 }, (_, i) =>
      makeResult(`func${i}`, i * 10, 1 - i * 0.05),
    );

    const fused = fuseSearchResults([list1], { limit: 5 });
    assert.equal(fused.length, 5);
  });
});

describe('explainRRFScore', () => {
  it('generates readable explanation', () => {
    const result = {
      key: 'test.ts:10',
      rrfScore: 0.032,
      ranks: [0, 2, -1],
      listCount: 2,
    };

    const explanation = explainRRFScore(result, ['keyword', 'vector', 'fuzzy']);

    assert.ok(explanation.includes('test.ts:10'));
    assert.ok(explanation.includes('keyword: rank 1'));
    assert.ok(explanation.includes('vector: rank 3'));
    assert.ok(explanation.includes('fuzzy: not present'));
    assert.ok(explanation.includes('2/3 lists'));
  });

  it('uses default list names when not provided', () => {
    const result = {
      key: 'doc-a',
      rrfScore: 0.016,
      ranks: [0],
      listCount: 1,
    };

    const explanation = explainRRFScore(result);
    assert.ok(explanation.includes('List 0'));
  });
});
