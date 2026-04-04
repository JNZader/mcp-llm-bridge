/**
 * Latency-based provider selector — Router integration for smart routing.
 *
 * Selects the best provider based on latency measurements, with fallback
 * to round-robin when latency data is unavailable or providers have
 * similar performance.
 */

import type { LatencyMeasurement, ProviderCandidate } from './types.js';

/** Threshold for considering latencies "similar" (20% difference) */
export const SIMILAR_LATENCY_THRESHOLD = 0.2;

/**
 * Select the best provider based on latency measurements.
 *
 * Strategy:
 * 1. If we have valid latency data for candidates, sort by latency
 * 2. If best latency is within 20% of second best, use round robin (similar performance)
 * 3. If no latency data or data is stale, fall back to round robin
 *
 * @param candidates - Array of provider candidates
 * @param latencyMeasurements - Map of provider -> latency in milliseconds
 * @param roundRobinIndex - Current round robin index for tie-breaking
 * @returns The selected provider candidate
 */
export function selectProviderWithLatency(
  candidates: ProviderCandidate[],
  latencyMeasurements: Map<string, number>,
  roundRobinIndex: number = 0,
): ProviderCandidate {
  if (candidates.length === 0) {
    throw new Error('No provider candidates available');
  }

  if (candidates.length === 1) {
    return candidates[0]!;
  }

  // Attach latency data to candidates (Infinity means no data)
  const withLatency = candidates.map((c) => ({
    ...c,
    latency: latencyMeasurements.get(c.provider) ?? Number.POSITIVE_INFINITY,
  }));

  // Separate candidates with valid latency from those without
  const withValidLatency = withLatency.filter((c) => c.latency > 0 && c.latency !== Number.POSITIVE_INFINITY);
  // withoutLatency intentionally computed but unused - kept for future logging/metrics

  // If no valid latency data, use round robin
  if (withValidLatency.length === 0) {
    return candidates[roundRobinIndex % candidates.length]!;
  }

  // Sort by latency (fastest first)
  withValidLatency.sort((a, b) => a.latency - b.latency);

  // If only one candidate has latency data, use it
  if (withValidLatency.length === 1) {
    const winner = withValidLatency[0]!;
    const original = candidates.find((c) => c.provider === winner.provider);
    if (original) {
      return original;
    }
  }

  // Check if best and second best are within 20% (similar performance)
  const best = withValidLatency[0]!;
  const second = withValidLatency[1];

  if (second) {
    const latencyDiff = (second.latency - best.latency) / best.latency;

    // If latencies are similar, use round robin for fairness
    if (latencyDiff < SIMILAR_LATENCY_THRESHOLD) {
      // Use candidates that have latency data for round robin
      const eligibleCandidates = candidates.filter((c) =>
        withValidLatency.some((w) => w.provider === c.provider)
      );
      return eligibleCandidates[roundRobinIndex % eligibleCandidates.length]!;
    }
  }

  // Use fastest provider
  const winner2 = withValidLatency[0]!;
  const original = candidates.find((c) => c.provider === winner2.provider);
  if (!original) {
    // Fallback to first candidate if something went wrong
    return candidates[0]!;
  }

  return original;
}

/**
 * Convert latency measurements array to a Map for easier lookup.
 * @param measurements - Array of latency measurements
 * @returns Map of provider -> latency in milliseconds
 */
export function measurementsToMap(
  measurements: LatencyMeasurement[],
): Map<string, number> {
  const map = new Map<string, number>();

  for (const m of measurements) {
    // Only include successful measurements (latency > 0)
    if (m.latencyMs > 0) {
      map.set(m.provider, m.latencyMs);
    }
  }

  return map;
}

/**
 * Build a latency map from the LatencyMeasurer.
 * Convenience function that filters out failed measurements.
 * @param measurements - Array of all measurements
 * @returns Map of provider -> latency in milliseconds (only successful)
 */
export function buildLatencyMap(measurements: LatencyMeasurement[]): Map<string, number> {
  return measurementsToMap(measurements);
}

/**
 * Check if latency-based selection should be used.
 * Returns true if we have valid latency data for at least one candidate.
 * @param candidates - Array of provider candidates
 * @param latencyMap - Map of provider -> latency
 * @returns True if latency selection is viable
 */
export function hasLatencyData(
  candidates: ProviderCandidate[],
  latencyMap: Map<string, number>,
): boolean {
  for (const candidate of candidates) {
    const latency = latencyMap.get(candidate.provider);
    if (latency !== undefined && latency > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Get latency statistics for a set of candidates.
 * @param candidates - Array of provider candidates
 * @param latencyMap - Map of provider -> latency
 * @returns Statistics object or null if no data
 */
export function getLatencyStats(
  candidates: ProviderCandidate[],
  latencyMap: Map<string, number>,
): { min: number; max: number; avg: number } | null {
  const latencies: number[] = [];

  for (const candidate of candidates) {
    const latency = latencyMap.get(candidate.provider);
    if (latency !== undefined && latency > 0) {
      latencies.push(latency);
    }
  }

  if (latencies.length === 0) {
    return null;
  }

  const min = Math.min(...latencies);
  const max = Math.max(...latencies);
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

  return { min, max, avg };
}
