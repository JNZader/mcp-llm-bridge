/**
 * Bridge types — task classification and cross-model routing.
 *
 * Defines the contract for heuristic-based task routing across
 * different LLM backends (CLI subscriptions).
 */

/** Known task types for heuristic classification. */
export type TaskType = 'large-context' | 'code-review' | 'fast-completion' | 'default';

/** A single route mapping a task type to a provider. */
export interface BridgeRoute {
  taskType: TaskType;
  provider: string;
}

/**
 * Bridge configuration loaded from bridge.yaml.
 *
 * Maps task types to preferred providers with a default
 * and ordered fallback chain.
 */
export interface BridgeConfig {
  /** Task type → provider ID mapping. */
  routes: Map<string, string>;
  /** Default provider when no route matches. */
  default: string;
  /** Ordered list of providers to try on failure. */
  fallbackOrder: string[];
}

/**
 * Raw YAML structure before parsing into BridgeConfig.
 */
export interface BridgeConfigRaw {
  routes?: Record<string, string>;
  default?: string;
  fallback_order?: string[];
}

/**
 * Classifier configuration for tuning heuristic thresholds.
 */
export interface ClassifierConfig {
  /** Token count threshold for large-context classification (default: 100000). */
  largeContextThreshold: number;
  /** Max prompt length for fast-completion classification (default: 500). */
  fastCompletionMaxLength: number;
  /** Keywords that trigger code-review classification. */
  codeReviewKeywords: string[];
}

/**
 * Normalized response from any bridge backend.
 *
 * Wraps the provider-specific response into a common format
 * with routing metadata.
 */
export interface BridgeResponse {
  /** Generated text content. */
  text: string;
  /** Provider that handled the request. */
  provider: string;
  /** Model used by the provider. */
  model: string;
  /** Classified task type. */
  taskType: TaskType;
  /** Whether a fallback provider was used. */
  fallbackUsed: boolean;
  /** Total latency in milliseconds. */
  latencyMs: number;
}
