/**
 * RTK-style output compression for tool call results.
 *
 * Strips redundant content from tool outputs before passing them to LLMs.
 * Applies 4 strategies in sequence:
 *   1. Filter  — remove irrelevant fields (timestamps, internal IDs, etc.)
 *   2. Group   — merge repeated similar entries into summaries
 *   3. Truncate — enforce max length on individual values
 *   4. Deduplicate — remove exact-duplicate entries
 *
 * Inspired by rtk-ai/rtk approach to output compression.
 */

// ── Types ──────────────────────────────────────────────────────

export interface OutputCompressionOptions {
  /** Fields to filter out from JSON objects. Default: common noise fields. */
  filterFields?: string[];
  /** Max characters per string value before truncation. Default: 500. */
  maxValueLength?: number;
  /** Similarity threshold for grouping (0-1). Default: 0.8. */
  groupThreshold?: number;
  /** Whether to apply deduplication. Default: true. */
  deduplicate?: boolean;
  /** Strategies to apply (in order). Default: all four. */
  strategies?: OutputStrategy[];
}

export type OutputStrategy = 'filter' | 'group' | 'truncate' | 'deduplicate';

const DEFAULT_FILTER_FIELDS = [
  'created_at', 'updated_at', 'modified_at', 'timestamp',
  'id', '_id', 'uuid', 'internal_id',
  'etag', 'version', 'revision',
  'cursor', 'next_cursor', 'prev_cursor',
  'request_id', 'trace_id', 'span_id',
  '__typename', '_links', '_embedded',
];

const DEFAULT_OPTIONS: Required<OutputCompressionOptions> = {
  filterFields: DEFAULT_FILTER_FIELDS,
  maxValueLength: 500,
  groupThreshold: 0.8,
  deduplicate: true,
  strategies: ['filter', 'group', 'truncate', 'deduplicate'],
};

// ── Strategy implementations ───────────────────────────────────

/**
 * Filter: remove noise fields from JSON objects.
 * Recursively walks the object tree and strips configured field names.
 */
function applyFilter(data: unknown, filterFields: Set<string>): unknown {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map((item) => applyFilter(item, filterFields));
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (filterFields.has(key)) continue;
      result[key] = applyFilter(value, filterFields);
    }
    return result;
  }

  return data;
}

/**
 * Group: merge arrays of similar objects into summaries.
 * When N items share the same keys, replace with a count + sample.
 */
function applyGroup(data: unknown, threshold: number): unknown {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data) && data.length > 3) {
    // Check if items are similar objects
    const objects = data.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item));

    if (objects.length === data.length) {
      const keySets = objects.map((obj) => Object.keys(obj as Record<string, unknown>).sort().join(','));
      const firstKeySet = keySets[0]!;
      const similarCount = keySets.filter((ks) => ks === firstKeySet).length;
      const similarity = similarCount / keySets.length;

      if (similarity >= threshold && data.length > 3) {
        const sample = data.slice(0, 2).map((item) => applyGroup(item, threshold));
        return {
          _grouped: true,
          _count: data.length,
          _sample: sample,
          _keys: firstKeySet.split(','),
        };
      }
    }

    return data.map((item) => applyGroup(item, threshold));
  }

  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = applyGroup(value, threshold);
    }
    return result;
  }

  return data;
}

/**
 * Truncate: enforce max length on string values.
 * Adds ellipsis indicator when truncated.
 */
function applyTruncate(data: unknown, maxLength: number): unknown {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    if (data.length > maxLength) {
      return data.slice(0, maxLength) + '…[truncated]';
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => applyTruncate(item, maxLength));
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = applyTruncate(value, maxLength);
    }
    return result;
  }

  return data;
}

/**
 * Deduplicate: remove exact-duplicate entries from arrays.
 * Uses JSON serialization for deep equality check.
 */
function applyDeduplicate(data: unknown): unknown {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    const seen = new Set<string>();
    const deduped: unknown[] = [];

    for (const item of data) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(applyDeduplicate(item));
      }
    }

    return deduped;
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = applyDeduplicate(value);
    }
    return result;
  }

  return data;
}

// ── Main compressor ────────────────────────────────────────────

/**
 * Compress tool output by applying RTK-style strategies.
 *
 * Accepts either a JSON string or a parsed object.
 * Returns the compressed version in the same format.
 *
 * @param output - Tool call result (string or object).
 * @param options - Compression options.
 * @returns Compressed output.
 */
export function compressOutput(
  output: string | unknown,
  options?: OutputCompressionOptions,
): string | unknown {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const filterFieldSet = new Set(opts.filterFields);

  const isString = typeof output === 'string';
  let data: unknown;

  if (isString) {
    try {
      data = JSON.parse(output as string);
    } catch {
      // Not JSON — apply truncate only on raw strings
      if (opts.strategies.includes('truncate') && (output as string).length > opts.maxValueLength) {
        return (output as string).slice(0, opts.maxValueLength) + '…[truncated]';
      }
      return output;
    }
  } else {
    data = output;
  }

  // Apply strategies in configured order
  for (const strategy of opts.strategies) {
    switch (strategy) {
      case 'filter':
        data = applyFilter(data, filterFieldSet);
        break;
      case 'group':
        data = applyGroup(data, opts.groupThreshold);
        break;
      case 'truncate':
        data = applyTruncate(data, opts.maxValueLength);
        break;
      case 'deduplicate':
        data = applyDeduplicate(data);
        break;
    }
  }

  return isString ? JSON.stringify(data) : data;
}

/**
 * Measure compression ratio for reporting.
 * Returns a value between 0 and 1 (lower = more compression).
 */
export function measureCompression(original: string, compressed: string): number {
  if (original.length === 0) return 1;
  return compressed.length / original.length;
}
