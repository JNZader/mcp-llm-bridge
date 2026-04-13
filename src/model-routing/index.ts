/**
 * Model Routing Module
 *
 * Generic model routing that sends tasks to the optimal model
 * based on task type, cost awareness, and quality thresholds.
 * Extends local-llm offloading with multi-model routing.
 *
 * Re-exports all model routing types and implementations.
 */

// Types
export {
  COST_TIER,
  QUALITY_LEVEL,
  COST_TIER_ORDER,
  DEFAULT_MODEL_ROUTING_CONFIG,
  compareCostTiers,
  type CostTier,
  type QualityLevel,
  type ModelEndpoint,
  type RouteRule,
  type RoutingDecision,
  type QualityFeedback,
  type QualityStats,
  type ModelRoutingConfig,
} from './types.js';

// Router
export {
  ModelRouter,
  rankEndpointsByCost,
} from './router.js';
