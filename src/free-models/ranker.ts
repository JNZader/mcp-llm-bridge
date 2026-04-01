/**
 * Free Model Ranker — scores and ranks available free models.
 *
 * Combines latency, reliability history, and capability match
 * into a composite score to select the best free model for a request.
 */

import type { FreeModelEntry, HealthCheckResult, ModelCapability, RankedFreeModel } from './types.js';
import type { HealthChecker } from './health.js';

/** Scoring weights (must sum to 1.0). */
const WEIGHTS = {
  latency: 0.4,
  reliability: 0.35,
  capability: 0.25,
} as const;

/** Maximum acceptable latency in ms for scoring. Above this = 0 latency score. */
const MAX_ACCEPTABLE_LATENCY_MS = 10_000;

/**
 * Compute a latency score from 0-100.
 * Lower latency = higher score. Null latency (unreachable) = 0.
 */
export function scoreLatency(latencyMs: number | null): number {
  if (latencyMs === null || latencyMs < 0) return 0;
  if (latencyMs >= MAX_ACCEPTABLE_LATENCY_MS) return 0;

  // Linear inverse: 0ms → 100, MAX_ACCEPTABLE → 0
  return Math.round((1 - latencyMs / MAX_ACCEPTABLE_LATENCY_MS) * 100);
}

/**
 * Compute a reliability score from 0-100.
 * Based on rolling success rate from HealthChecker (0-1 → 0-100).
 */
export function scoreReliability(reliability: number): number {
  return Math.round(Math.max(0, Math.min(1, reliability)) * 100);
}

/**
 * Compute a capability match score from 0-100.
 * Models matching more requested capabilities score higher.
 * No required capabilities = all models get 100.
 */
export function scoreCapability(
  modelCapabilities: ModelCapability[],
  requiredCapabilities: ModelCapability[],
): number {
  if (requiredCapabilities.length === 0) return 100;

  const matched = requiredCapabilities.filter((c) =>
    modelCapabilities.includes(c),
  ).length;

  return Math.round((matched / requiredCapabilities.length) * 100);
}

/**
 * Compute the composite score for a model.
 * Weighted combination of latency, reliability, and capability scores.
 */
export function computeScore(
  latencyScore: number,
  reliabilityScore: number,
  capabilityScore: number,
): number {
  return Math.round(
    latencyScore * WEIGHTS.latency +
    reliabilityScore * WEIGHTS.reliability +
    capabilityScore * WEIGHTS.capability,
  );
}

/**
 * Rank free models by composite score.
 *
 * Filters out unhealthy (status === 'down') models, then scores
 * and sorts the remaining candidates.
 *
 * @param entries      Available model entries (pre-filtered to enabled)
 * @param healthChecker Health checker with cached results
 * @param requiredCapabilities Capabilities the request needs (empty = any)
 * @returns Ranked list sorted by score descending
 */
export function rankModels(
  entries: FreeModelEntry[],
  healthChecker: HealthChecker,
  requiredCapabilities: ModelCapability[] = [],
): RankedFreeModel[] {
  const ranked: RankedFreeModel[] = [];

  for (const entry of entries) {
    const health: HealthCheckResult = healthChecker.getHealth(entry.id) ?? {
      modelId: entry.id,
      status: 'unknown',
      latencyMs: null,
      lastChecked: new Date().toISOString(),
    };

    // Skip models that are confirmed down
    if (health.status === 'down') continue;

    const latencyScore = scoreLatency(health.latencyMs);
    const reliabilityScore = scoreReliability(healthChecker.getReliability(entry.id));
    const capabilityScore = scoreCapability(entry.capabilities, requiredCapabilities);

    const score = computeScore(latencyScore, reliabilityScore, capabilityScore);

    ranked.push({
      entry,
      health,
      score,
      breakdown: {
        latencyScore,
        reliabilityScore,
        capabilityScore,
      },
    });
  }

  // Sort by score descending
  ranked.sort((a, b) => b.score - a.score);

  return ranked;
}
