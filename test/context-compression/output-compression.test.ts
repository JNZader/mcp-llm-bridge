/**
 * RTK-style output compression — filter, group, truncate, deduplicate.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  compressOutput,
  measureCompression,
} from '../../src/context-compression/output-compression.js';

describe('compressOutput — filter strategy', () => {
  it('removes default noise fields from objects', () => {
    const input = {
      name: 'test',
      created_at: '2024-01-01',
      updated_at: '2024-01-02',
      id: 123,
      _links: { self: '/api/test' },
    };

    const result = compressOutput(input, { strategies: ['filter'] }) as Record<string, unknown>;
    assert.equal(result['name'], 'test');
    assert.equal(result['created_at'], undefined);
    assert.equal(result['updated_at'], undefined);
    assert.equal(result['id'], undefined);
    assert.equal(result['_links'], undefined);
  });

  it('filters nested objects recursively', () => {
    const input = {
      user: { name: 'Alice', trace_id: 'abc', profile: { bio: 'dev', uuid: '123' } },
    };

    const result = compressOutput(input, { strategies: ['filter'] }) as Record<string, unknown>;
    const user = result['user'] as Record<string, unknown>;
    assert.equal(user['name'], 'Alice');
    assert.equal(user['trace_id'], undefined);
    const profile = user['profile'] as Record<string, unknown>;
    assert.equal(profile['bio'], 'dev');
    assert.equal(profile['uuid'], undefined);
  });

  it('filters arrays of objects', () => {
    const input = [
      { name: 'a', id: 1 },
      { name: 'b', id: 2 },
    ];

    const result = compressOutput(input, { strategies: ['filter'] }) as Array<Record<string, unknown>>;
    assert.equal(result.length, 2);
    assert.equal(result[0]!['name'], 'a');
    assert.equal(result[0]!['id'], undefined);
  });

  it('uses custom filter fields', () => {
    const input = { foo: 1, bar: 2, baz: 3 };
    const result = compressOutput(input, {
      strategies: ['filter'],
      filterFields: ['bar', 'baz'],
    }) as Record<string, unknown>;

    assert.deepEqual(result, { foo: 1 });
  });
});

describe('compressOutput — group strategy', () => {
  it('groups arrays of similar objects into summaries', () => {
    const input = Array.from({ length: 10 }, (_, i) => ({
      name: `item-${i}`,
      type: 'widget',
      active: true,
    }));

    const result = compressOutput(input, { strategies: ['group'] }) as Record<string, unknown>;
    assert.equal(result['_grouped'], true);
    assert.equal(result['_count'], 10);
    assert.ok(Array.isArray(result['_sample']));
    assert.equal((result['_sample'] as unknown[]).length, 2);
  });

  it('does not group small arrays', () => {
    const input = [
      { name: 'a', type: 'x' },
      { name: 'b', type: 'y' },
    ];

    const result = compressOutput(input, { strategies: ['group'] }) as unknown[];
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 2);
  });

  it('does not group arrays with different structures', () => {
    const input = [
      { name: 'a' },
      { title: 'b' },
      { name: 'c' },
      { title: 'd' },
    ];

    const result = compressOutput(input, { strategies: ['group'] }) as unknown[];
    // Mixed structures should not group — similarity below threshold
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 4);
  });
});

describe('compressOutput — truncate strategy', () => {
  it('truncates long string values', () => {
    const longText = 'x'.repeat(1000);
    const input = { description: longText };

    const result = compressOutput(input, {
      strategies: ['truncate'],
      maxValueLength: 100,
    }) as Record<string, unknown>;

    const desc = result['description'] as string;
    assert.ok(desc.length < 200);
    assert.ok(desc.includes('…[truncated]'));
  });

  it('leaves short strings unchanged', () => {
    const input = { name: 'short' };
    const result = compressOutput(input, {
      strategies: ['truncate'],
      maxValueLength: 100,
    }) as Record<string, unknown>;

    assert.equal(result['name'], 'short');
  });

  it('truncates raw non-JSON strings', () => {
    const longStr = 'a'.repeat(1000);
    const result = compressOutput(longStr, {
      strategies: ['truncate'],
      maxValueLength: 50,
    }) as string;

    assert.ok(result.length < 100);
    assert.ok(result.includes('…[truncated]'));
  });
});

describe('compressOutput — deduplicate strategy', () => {
  it('removes exact duplicate array entries', () => {
    const input = [
      { name: 'a', value: 1 },
      { name: 'b', value: 2 },
      { name: 'a', value: 1 },
      { name: 'b', value: 2 },
    ];

    const result = compressOutput(input, { strategies: ['deduplicate'] }) as Array<Record<string, unknown>>;
    assert.equal(result.length, 2);
    assert.equal(result[0]!['name'], 'a');
    assert.equal(result[1]!['name'], 'b');
  });

  it('preserves non-duplicates', () => {
    const input = [
      { name: 'a', value: 1 },
      { name: 'b', value: 2 },
      { name: 'c', value: 3 },
    ];

    const result = compressOutput(input, { strategies: ['deduplicate'] }) as unknown[];
    assert.equal(result.length, 3);
  });
});

describe('compressOutput — combined strategies', () => {
  it('applies all strategies in sequence', () => {
    const input = JSON.stringify([
      { name: 'a', id: 1, desc: 'x'.repeat(600) },
      { name: 'b', id: 2, desc: 'y'.repeat(600) },
      { name: 'a', id: 1, desc: 'x'.repeat(600) },
    ]);

    const result = compressOutput(input) as string;
    assert.ok(typeof result === 'string');

    const parsed = JSON.parse(result) as unknown[];
    // Should have deduped (3 → 2 after filter removes id, then dedup)
    assert.ok(parsed.length <= 2, `Expected deduplication, got ${parsed.length} items`);
  });

  it('handles JSON string input and returns JSON string', () => {
    const input = JSON.stringify({ name: 'test', id: 42 });
    const result = compressOutput(input) as string;

    assert.ok(typeof result === 'string');
    const parsed = JSON.parse(result) as Record<string, unknown>;
    assert.equal(parsed['name'], 'test');
    assert.equal(parsed['id'], undefined);
  });

  it('returns non-JSON strings as-is when short', () => {
    const input = 'simple text output';
    const result = compressOutput(input);
    assert.equal(result, input);
  });
});

describe('measureCompression', () => {
  it('returns 1 for same-length strings', () => {
    assert.equal(measureCompression('abc', 'abc'), 1);
  });

  it('returns ratio for different lengths', () => {
    const ratio = measureCompression('a'.repeat(100), 'a'.repeat(50));
    assert.equal(ratio, 0.5);
  });

  it('returns 1 for empty original', () => {
    assert.equal(measureCompression('', 'anything'), 1);
  });
});
