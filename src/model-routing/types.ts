/**
 * Model routing — types and interfaces.
 *
 * Generic model routing that sends tasks to the optimal model
 * based on task type, cost awareness, and quality thresholds.
 * Extends local-llm offloading with multi-model routing.
 */

import type { OffloadTask } from '../local-llm/types.js';

/** Cost tier for model pricing. */
export const COST_TIER = {
  FREE: 'free',
  CHEAP: 'cheap',
  STANDARD: 'standard',
  EXPENSIVE: 'expensive',
} as const;

export type CostTier = (typeof COST_TIER)[keyof typeof COST_TIER];

/** Quality level expected from a model for a given task. */
export const QUALITY_LEVEL = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

export type QualityLevel = (typeof QUALITY_LEVEL)[keyof typeof QUALITY_LEVEL];

/**
 * A model endpoint that can receive routed tasks.
 */
export interface ModelEndpoint {
  /** Unique identifier for this endpoint. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Provider key (e.g., "ollama", "openai", "anthropic"). */
  provider: string;
  /** Model identifier for API calls. */
  modelId: string;
  /** Cost tier for routing decisions. */
  costTier: CostTier;
  /** Capability tags. */
  capabilities: string[];
  /** Whether this is a local model (no token cost). */
  isLocal: boolean;
  /** Maximum context window in tokens. */
  maxTokens: number;
  /** Whether this endpoint is currently available. */
  available: boolean;
}

/**
 * A routing rule that maps task patterns to model preferences.
 */
export interface RouteRule {
  /** Unique rule identifier. */
  id: string;
  /** Task type pattern to match (from local-llm classification). */
  taskPattern: OffloadTask | '*';
  /** Optional keyword patterns for finer matching. */
  keywordPatterns?: string[];
  /** Ordered list of preferred model endpoint IDs. */
  preferredModels: string[];
  /** Maximum cost tier allowed for this task. */
  maxCostTier: CostTier;
  /** Minimum quality level required. */
  minQuality: QualityLevel;
  /** Whether to enable fallback to expensive models. */
  allowFallback: boolean;
}

/**
 * Result of a routing decision.
 */
export interface RoutingDecision {
  /** Selected model endpoint. */
  endpoint: ModelEndpoint;
  /** Rule that matched. */
  matchedRule: RouteRule;
  /** Why this model was selected. */
  reason: string;
  /** Whether a fallback was used (not first preference). */
  isFallback: boolean;
  /** Estimated cost tier of this decision. */
  costTier: CostTier;
}

/**
 * Quality feedback for adaptive routing.
 */
export interface QualityFeedback {
  /** Model endpoint ID that produced the response. */
  endpointId: string;
  /** Task pattern that was routed. */
  taskPattern: OffloadTask | '*';
  /** Whether the response met quality expectations. */
  acceptable: boolean;
  /** Response latency in ms. */
  latencyMs: number;
  /** ISO timestamp. */
  timestamp: string;
}

/**
 * Aggregated quality stats for a model+task combination.
 */
export interface QualityStats {
  /** Model endpoint ID. */
  endpointId: string;
  /** Task pattern. */
  taskPattern: OffloadTask | '*';
  /** Total number of requests. */
  totalRequests: number;
  /** Number of acceptable responses. */
  acceptableCount: number;
  /** Acceptance rate (0-1). */
  acceptanceRate: number;
  /** Average latency in ms. */
  avgLatencyMs: number;
}

/**
 * Configuration for the model routing system.
 */
export interface ModelRoutingConfig {
  /** Whether model routing is enabled. */
  enabled: boolean;
  /** Registered model endpoints. */
  endpoints: ModelEndpoint[];
  /** Routing rules (evaluated in order, first match wins). */
  rules: RouteRule[];
  /** Default model endpoint ID when no rule matches. */
  defaultEndpoint: string;
  /** Quality acceptance rate threshold for fallback (default: 0.7). */
  qualityThreshold: number;
  /** Number of recent requests to consider for quality stats (default: 50). */
  qualityWindowSize: number;
}

/** Default model routing configuration. */
export const DEFAULT_MODEL_ROUTING_CONFIG: ModelRoutingConfig = {
  enabled: false,
  endpoints: [],
  rules: [],
  defaultEndpoint: '',
  qualityThreshold: 0.7,
  qualityWindowSize: 50,
};

/**
 * Cost tier ordering for comparison (lower index = cheaper).
 */
export const COST_TIER_ORDER: CostTier[] = [
  COST_TIER.FREE,
  COST_TIER.CHEAP,
  COST_TIER.STANDARD,
  COST_TIER.EXPENSIVE,
];

/**
 * Compare two cost tiers. Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareCostTiers(a: CostTier, b: CostTier): number {
  return COST_TIER_ORDER.indexOf(a) - COST_TIER_ORDER.indexOf(b);
}
