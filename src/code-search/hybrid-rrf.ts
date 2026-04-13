/**
 * Hybrid search with Reciprocal Rank Fusion (RRF).
 *
 * Combines multiple ranked result lists into a single fused ranking.
 * RRF is retrieval-method agnostic — it works with keyword search,
 * vector search, fuzzy search, or any combination.
 *
 * Formula: score(d) = Σ 1/(k + rank_i(d)) for each result list i
 *   where k is a constant (default: 60) that dampens the effect
 *   of high rankings from a single list.
 *
 * Inspired by garrytan/gbrain approach to combining search signals.
 *
 * Reference: Cormack, Clarke & Büttcher (2009) "Reciprocal Rank Fusion
 *   outperforms Condorcet and individual Rank Learning Methods"
 */

import type { SearchResult } from './types.js';

// ── Types ──────────────────────────────────────────────────────

export interface RRFOptions {
  /** Dampening constant k. Default: 60. Higher = less weight to top results. */
  k?: number;
  /** Maximum number of results to return. Default: 10. */
  limit?: number;
  /** Minimum RRF score threshold. Results below this are excluded. Default: 0. */
  minScore?: number;
  /** Optional weights per result list (indexed by position). Default: equal weight. */
  weights?: number[];
}

export interface RRFResult {
  /** The item identifier. */
  key: string;
  /** The fused RRF score. */
  rrfScore: number;
  /** Individual rank in each input list (0-indexed, -1 = not present). */
  ranks: number[];
  /** Number of lists this item appeared in. */
  listCount: number;
}

export interface FusedSearchResult extends SearchResult {
  /** The RRF fusion score. */
  rrfScore: number;
  /** How many search methods found this result. */
  methodCount: number;
}

// ── Core RRF ───────────────────────────────────────────────────

/**
 * Apply Reciprocal Rank Fusion to multiple ranked lists.
 *
 * Each list is an array of string keys in ranked order (best first).
 * Returns fused results sorted by RRF score descending.
 *
 * @param rankedLists - Array of ranked key lists.
 * @param options - RRF configuration.
 * @returns Fused ranked results.
 */
export function reciprocalRankFusion(
  rankedLists: string[][],
  options?: RRFOptions,
): RRFResult[] {
  const k = options?.k ?? 60;
  const limit = options?.limit ?? 10;
  const minScore = options?.minScore ?? 0;
  const weights = options?.weights ?? rankedLists.map(() => 1);

  if (rankedLists.length === 0) return [];

  // Collect all unique keys and their ranks per list
  const scoreMap = new Map<string, { score: number; ranks: number[]; listCount: number }>();

  for (let listIdx = 0; listIdx < rankedLists.length; listIdx++) {
    const list = rankedLists[listIdx]!;
    const weight = weights[listIdx] ?? 1;

    for (let rank = 0; rank < list.length; rank++) {
      const key = list[rank]!;
      let entry = scoreMap.get(key);

      if (!entry) {
        entry = {
          score: 0,
          ranks: new Array(rankedLists.length).fill(-1) as number[],
          listCount: 0,
        };
        scoreMap.set(key, entry);
      }

      entry.ranks[listIdx] = rank;
      entry.score += weight * (1 / (k + rank + 1)); // rank is 0-indexed, formula uses 1-indexed
      entry.listCount++;
    }
  }

  // Sort by score descending, apply threshold and limit
  const results: RRFResult[] = [];
  for (const [key, entry] of scoreMap) {
    if (entry.score >= minScore) {
      results.push({
        key,
        rrfScore: entry.score,
        ranks: entry.ranks,
        listCount: entry.listCount,
      });
    }
  }

  results.sort((a, b) => b.rrfScore - a.rrfScore);
  return results.slice(0, limit);
}

// ── SearchResult fusion ────────────────────────────────────────

/**
 * Fuse multiple SearchResult arrays using RRF.
 *
 * Each input array is a ranked list from a different search method
 * (keyword, vector, fuzzy, etc.). Results are identified by
 * `filePath:startLine` as a unique key.
 *
 * @param resultLists - Arrays of SearchResult from different methods.
 * @param options - RRF configuration.
 * @returns Fused search results with RRF scores.
 */
export function fuseSearchResults(
  resultLists: SearchResult[][],
  options?: RRFOptions,
): FusedSearchResult[] {
  if (resultLists.length === 0) return [];

  // Build a map of key → SearchResult for lookup
  const resultMap = new Map<string, SearchResult>();

  const rankedKeys: string[][] = resultLists.map((list) =>
    list.map((result) => {
      const key = `${result.filePath}:${result.startLine}`;
      // Keep the first occurrence (highest-ranked from any method)
      if (!resultMap.has(key)) {
        resultMap.set(key, result);
      }
      return key;
    }),
  );

  // Apply RRF
  const rrfResults = reciprocalRankFusion(rankedKeys, options);

  // Map back to FusedSearchResult
  return rrfResults
    .map((rrf) => {
      const original = resultMap.get(rrf.key);
      if (!original) return null;

      return {
        ...original,
        score: rrf.rrfScore, // Override original score with RRF score
        rrfScore: rrf.rrfScore,
        methodCount: rrf.listCount,
      };
    })
    .filter((r): r is FusedSearchResult => r !== null);
}

// ── Utility ────────────────────────────────────────────────────

/**
 * Explain RRF scoring for debugging.
 * Returns a human-readable breakdown of how a result was scored.
 */
export function explainRRFScore(result: RRFResult, listNames?: string[], k = 60): string {
  const lines: string[] = [`RRF Score for "${result.key}": ${result.rrfScore.toFixed(6)}`];
  lines.push(`  Appeared in ${result.listCount}/${result.ranks.length} lists`);

  for (let i = 0; i < result.ranks.length; i++) {
    const rank = result.ranks[i]!;
    const name = listNames?.[i] ?? `List ${i}`;

    if (rank === -1) {
      lines.push(`  ${name}: not present`);
    } else {
      const contribution = 1 / (k + rank + 1);
      lines.push(`  ${name}: rank ${rank + 1} → 1/(${k}+${rank + 1}) = ${contribution.toFixed(6)}`);
    }
  }

  return lines.join('\n');
}
