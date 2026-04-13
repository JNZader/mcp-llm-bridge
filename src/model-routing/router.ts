/**
 * Model router — cost-aware routing with quality fallback.
 *
 * Evaluates routing rules against task classifications, selects
 * the cheapest available model that meets quality thresholds,
 * and falls back to expensive models when quality drops.
 */

import type {
  ModelEndpoint,
  ModelRoutingConfig,
  RouteRule,
  RoutingDecision,
  QualityFeedback,
  QualityStats,
  CostTier,
} from './types.js';
import { COST_TIER_ORDER, compareCostTiers, DEFAULT_MODEL_ROUTING_CONFIG } from './types.js';
import type { TaskClassification } from '../local-llm/types.js';

/**
 * ModelRouter manages rule-based routing with quality tracking.
 *
 * Routing flow:
 * 1. Match task classification against rules (first match wins)
 * 2. Filter preferred models by availability and cost tier
 * 3. Check quality stats — skip models below quality threshold
 * 4. Select cheapest qualifying model
 * 5. If none qualify, fallback to default (if allowed)
 */
export class ModelRouter {
  private readonly config: ModelRoutingConfig;
  private readonly endpointMap: Map<string, ModelEndpoint>;
  private readonly feedbackLog: QualityFeedback[] = [];

  constructor(config?: Partial<ModelRoutingConfig>) {
    this.config = { ...DEFAULT_MODEL_ROUTING_CONFIG, ...config };
    this.endpointMap = new Map(
      this.config.endpoints.map((e) => [e.id, e]),
    );
  }

  /**
   * Route a classified task to the optimal model endpoint.
   *
   * Returns null if no suitable endpoint is found (caller should
   * use their own fallback logic).
   */
  route(classification: TaskClassification): RoutingDecision | null {
    // 1. Find matching rule
    const rule = this.findMatchingRule(classification);
    if (!rule) {
      return this.routeToDefault(classification);
    }

    // 2. Resolve preferred models in order
    for (const [index, modelId] of rule.preferredModels.entries()) {
      const endpoint = this.endpointMap.get(modelId);
      if (!endpoint?.available) continue;

      // 3. Check cost tier constraint
      if (compareCostTiers(endpoint.costTier, rule.maxCostTier) > 0) continue;

      // 4. Check quality stats
      const stats = this.getQualityStats(modelId, classification.task);
      if (stats && stats.totalRequests >= 5 && stats.acceptanceRate < this.config.qualityThreshold) {
        continue; // Quality too low, try next
      }

      return {
        endpoint,
        matchedRule: rule,
        reason: index === 0
          ? `Primary model for ${classification.task}`
          : `Fallback #${index} for ${classification.task}`,
        isFallback: index > 0,
        costTier: endpoint.costTier,
      };
    }

    // 5. All preferred models failed — fallback to default if allowed
    if (rule.allowFallback) {
      return this.routeToDefault(classification, rule);
    }

    return null;
  }

  /**
   * Record quality feedback for adaptive routing.
   */
  recordFeedback(feedback: QualityFeedback): void {
    this.feedbackLog.push(feedback);

    // Keep only the last N entries per endpoint+task to bound memory
    const maxSize = this.config.qualityWindowSize * this.config.endpoints.length * 2;
    if (this.feedbackLog.length > maxSize) {
      this.feedbackLog.splice(0, this.feedbackLog.length - maxSize);
    }
  }

  /**
   * Get quality stats for a model+task combination.
   */
  getQualityStats(endpointId: string, taskPattern: string): QualityStats | null {
    const relevant = this.feedbackLog
      .filter((f) => f.endpointId === endpointId && f.taskPattern === taskPattern)
      .slice(-this.config.qualityWindowSize);

    if (relevant.length === 0) return null;

    const acceptableCount = relevant.filter((f) => f.acceptable).length;
    const avgLatencyMs = relevant.reduce((sum, f) => sum + f.latencyMs, 0) / relevant.length;

    return {
      endpointId,
      taskPattern: taskPattern as QualityStats['taskPattern'],
      totalRequests: relevant.length,
      acceptableCount,
      acceptanceRate: acceptableCount / relevant.length,
      avgLatencyMs,
    };
  }

  /**
   * Get all registered endpoints sorted by cost (cheapest first).
   */
  getEndpointsByCost(): ModelEndpoint[] {
    return [...this.config.endpoints]
      .filter((e) => e.available)
      .sort((a, b) => compareCostTiers(a.costTier, b.costTier));
  }

  /**
   * Update endpoint availability (e.g., after health check).
   */
  setEndpointAvailability(endpointId: string, available: boolean): void {
    const endpoint = this.endpointMap.get(endpointId);
    if (endpoint) {
      endpoint.available = available;
    }
  }

  /**
   * Find the first matching rule for a task classification.
   */
  private findMatchingRule(classification: TaskClassification): RouteRule | null {
    for (const rule of this.config.rules) {
      // Match by task pattern
      if (rule.taskPattern !== '*' && rule.taskPattern !== classification.task) {
        continue;
      }
      return rule;
    }
    return null;
  }

  /**
   * Route to the default endpoint as fallback.
   */
  private routeToDefault(
    classification: TaskClassification,
    matchedRule?: RouteRule,
  ): RoutingDecision | null {
    const endpoint = this.endpointMap.get(this.config.defaultEndpoint);
    if (!endpoint?.available) return null;

    const rule: RouteRule = matchedRule ?? {
      id: 'default',
      taskPattern: '*',
      preferredModels: [this.config.defaultEndpoint],
      maxCostTier: 'expensive' as CostTier,
      minQuality: 'low' as QualityStats['taskPattern'] extends string ? 'low' : never,
      allowFallback: false,
    };

    return {
      endpoint,
      matchedRule: rule,
      reason: `Default model — no specific rule matched for ${classification.task}`,
      isFallback: true,
      costTier: endpoint.costTier,
    };
  }
}

/**
 * Build a cost-tier-sorted list of available endpoints.
 * Utility for external consumers that need ranked options.
 */
export function rankEndpointsByCost(
  endpoints: ModelEndpoint[],
  maxTier?: CostTier,
): ModelEndpoint[] {
  let filtered = endpoints.filter((e) => e.available);

  if (maxTier) {
    const maxIndex = COST_TIER_ORDER.indexOf(maxTier);
    filtered = filtered.filter((e) => COST_TIER_ORDER.indexOf(e.costTier) <= maxIndex);
  }

  return filtered.sort((a, b) => compareCostTiers(a.costTier, b.costTier));
}
