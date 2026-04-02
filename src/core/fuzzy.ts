/**
 * Fuzzy Model/Group Name Resolution
 *
 * Provides Jaro-Winkler similarity matching for model and group names.
 * Zero external dependencies — pure TypeScript implementation.
 *
 * Resolution cascade: exact match -> normalized match -> Jaro-Winkler.
 * Ambiguity guard rejects when top-2 scores differ by less than delta.
 */

import { normalizeModelName } from './pricing.js';
import { logger } from './logger.js';

/** Result of a fuzzy model resolution. */
export interface FuzzyResult {
  /** Original corpus entry that matched (not normalized). */
  match: string;
  /** Jaro-Winkler similarity score (0.0 - 1.0). */
  score: number;
}

/** Options for resolveModel(). */
export interface ResolveOptions {
  /** Minimum score to accept a match. Default: 0.85. */
  threshold?: number;
  /** Minimum gap between top-2 candidates. Default: 0.02. */
  ambiguityDelta?: number;
}

const DEFAULT_THRESHOLD = 0.85;
const DEFAULT_AMBIGUITY_DELTA = 0.02;

/**
 * Normalize a model ID for fuzzy comparison.
 *
 * Wraps pricing's normalizeModelName and additionally handles:
 * - Provider prefixes with colon (e.g., "openai:gpt-4o" -> "gpt-4o")
 * - Slash separators (e.g., "openai/gpt-4o" -> "gpt-4o")
 */
export function normalizeModelId(id: string): string {
  let cleaned = id;

  // Strip provider prefix (colon separator)
  const colonIdx = cleaned.indexOf(':');
  if (colonIdx !== -1) {
    cleaned = cleaned.slice(colonIdx + 1);
  }

  // Strip provider prefix (slash separator)
  const slashIdx = cleaned.lastIndexOf('/');
  if (slashIdx !== -1) {
    cleaned = cleaned.slice(slashIdx + 1);
  }

  return normalizeModelName(cleaned);
}

/**
 * Compute Jaro-Winkler similarity between two strings.
 *
 * Returns a score between 0.0 (no match) and 1.0 (identical).
 * Winkler prefix bonus: p = 0.1, max prefix length = 4.
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const maxDist = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  if (maxDist < 0) return a === b ? 1.0 : 0.0;

  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matching characters
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(i + maxDist + 1, b.length);

    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / a.length +
      matches / b.length +
      (matches - transpositions / 2) / matches) /
    3;

  // Winkler prefix bonus (p = 0.1, max 4 chars)
  let prefix = 0;
  const maxPrefix = Math.min(4, Math.min(a.length, b.length));
  for (let i = 0; i < maxPrefix; i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Resolve a model ID against a corpus using exact -> normalized -> Jaro-Winkler.
 *
 * Returns null if no match above threshold or if ambiguous (top-2 gap < delta).
 */
export function resolveModel(
  input: string,
  corpus: string[],
  options?: ResolveOptions,
): FuzzyResult | null {
  if (corpus.length === 0) return null;

  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const ambiguityDelta = options?.ambiguityDelta ?? DEFAULT_AMBIGUITY_DELTA;

  // 1. Exact match
  const exactMatch = corpus.find((c) => c === input);
  if (exactMatch) {
    return { match: exactMatch, score: 1.0 };
  }

  // 2. Normalized exact match
  const normalizedInput = normalizeModelId(input);
  for (const entry of corpus) {
    if (normalizeModelId(entry) === normalizedInput) {
      return { match: entry, score: 1.0 };
    }
  }

  // 3. Jaro-Winkler on normalized strings
  let best: { entry: string; score: number } | null = null;
  let secondBest = 0;

  for (const entry of corpus) {
    const score = jaroWinkler(normalizedInput, normalizeModelId(entry));
    if (!best || score > best.score) {
      secondBest = best?.score ?? 0;
      best = { entry, score };
    } else if (score > secondBest) {
      secondBest = score;
    }
  }

  if (!best || best.score < threshold) {
    return null;
  }

  // Ambiguity guard: reject if top-2 are too close
  if (best.score - secondBest < ambiguityDelta) {
    logger.warn(
      {
        input,
        candidate1: best.entry,
        score1: best.score,
        score2: secondBest,
      },
      'Fuzzy match rejected: ambiguous — top-2 scores too close',
    );
    return null;
  }

  logger.warn(
    { input, resolved: best.entry, score: best.score },
    'Fuzzy model resolution activated',
  );

  return { match: best.entry, score: best.score };
}
