/**
 * Unit tests for BM25Index.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BM25Index, BM25Document } from '../../src/code-search/bm25-index.js';

describe('BM25Index', () => {
  it('is available when minisearch is installed', () => {
    const index = new BM25Index();
    assert.equal(index.isAvailable(), true);
  });

  it('adds documents and returns ranked search results', () => {
    const index = new BM25Index();

    const docs: BM25Document[] = [
      { id: '1', name: 'greet', content: 'function greet(name: string): string { return `Hello, ${name}`; }' },
      { id: '2', name: 'fetchData', content: 'async function fetchData(url: string): Promise<Response> { return fetch(url); }' },
      { id: '3', name: 'add', content: 'function add(a: number, b: number): number { return a + b; }' },
    ];

    for (const doc of docs) index.add(doc);

    const results = index.search('function', 10);
    assert.ok(results.length > 0, 'Expected results for "function"');
    assert.ok(results[0]!.score > 0, 'Expected positive score');
    assert.equal(results.length, 3);
  });

  it('boosts name matches higher than content matches', () => {
    const index = new BM25Index();

    const docs: BM25Document[] = [
      { id: '1', name: 'authenticate', content: 'Handles user login and session management' },
      { id: '2', name: 'session', content: 'authenticate the user with credentials' },
    ];

    for (const doc of docs) index.add(doc);

    const results = index.search('authenticate', 10);
    assert.equal(results.length, 2);

    // The document whose name is "authenticate" should score higher
    const nameMatch = results.find((r) => r.id === '1');
    const contentMatch = results.find((r) => r.id === '2');

    assert.ok(nameMatch, 'Expected name match to exist');
    assert.ok(contentMatch, 'Expected content match to exist');
    assert.ok(
      nameMatch!.score > contentMatch!.score,
      `Name match score (${nameMatch!.score}) should exceed content match score (${contentMatch!.score})`
    );
  });

  it('ranks multiple documents correctly', () => {
    const index = new BM25Index();

    const docs: BM25Document[] = [
      { id: 'a', name: 'alpha', content: 'alpha beta gamma' },
      { id: 'b', name: 'beta', content: 'alpha beta gamma delta epsilon' },
      { id: 'c', name: 'gamma', content: 'alpha beta' },
    ];

    for (const doc of docs) index.add(doc);

    const results = index.search('alpha', 10);
    assert.equal(results.length, 3);

    // All results should have unique IDs
    const ids = results.map((r) => r.id);
    assert.equal(new Set(ids).size, 3, 'All results should have distinct IDs');

    // Scores should be descending
    for (let i = 0; i < results.length - 1; i++) {
      assert.ok(
        results[i]!.score >= results[i + 1]!.score,
        'Scores should be in descending order'
      );
    }
  });

  it('clears all documents', () => {
    const index = new BM25Index();

    index.add({ id: '1', name: 'foo', content: 'foo bar' });
    index.add({ id: '2', name: 'baz', content: 'baz qux' });

    assert.equal(index.size(), 2);

    index.clear();
    assert.equal(index.size(), 0);

    const results = index.search('foo', 10);
    assert.equal(results.length, 0);
  });

  it('returns empty array for empty query', () => {
    const index = new BM25Index();
    index.add({ id: '1', name: 'foo', content: 'foo bar' });

    const results = index.search('', 10);
    assert.equal(results.length, 0);

    const resultsWhitespace = index.search('   ', 10);
    assert.equal(resultsWhitespace.length, 0);
  });

  it('returns empty array when no documents match', () => {
    const index = new BM25Index();
    index.add({ id: '1', name: 'foo', content: 'foo bar' });

    const results = index.search('nonexistentterm12345', 10);
    assert.equal(results.length, 0);
  });

  it('respects the limit parameter', () => {
    const index = new BM25Index();

    for (let i = 0; i < 10; i++) {
      index.add({ id: String(i), name: `func${i}`, content: 'shared content token' });
    }

    const results = index.search('shared', 3);
    assert.equal(results.length, 3);

    const resultsHigh = index.search('shared', 50);
    assert.equal(resultsHigh.length, 10);
  });

  it('returns reasonable score values', () => {
    const index = new BM25Index();

    index.add({ id: '1', name: 'foo', content: 'foo bar baz' });
    index.add({ id: '2', name: 'bar', content: 'bar qux' });

    const results = index.search('bar', 10);
    assert.ok(results.length > 0);

    for (const r of results) {
      assert.ok(r.score > 0, `Score should be positive, got ${r.score}`);
      assert.ok(Number.isFinite(r.score), `Score should be finite, got ${r.score}`);
    }
  });

  it('includes stored name field in results', () => {
    const index = new BM25Index();
    index.add({ id: '1', name: 'myFunction', content: 'some code here' });

    const results = index.search('code', 10);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.id, '1');
    assert.equal(results[0]!.name, 'myFunction');
    assert.ok(results[0]!.score > 0);
  });
});
