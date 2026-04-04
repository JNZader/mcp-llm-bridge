/**
 * Free Model Routing — types and interfaces.
 *
 * Defines the contract for free model endpoints, health status,
 * registry configuration, and ranking results.
 */

/** Capability tags for free model endpoints. */
export type ModelCapability = 'chat' | 'code' | 'reasoning' | 'vision' | 'embedding';

/** Health status of a free model endpoint. */
export type HealthStatus = 'unknown' | 'healthy' | 'degraded' | 'down';

/**
 * A registered free model endpoint.
 *
 * Each entry describes a publicly available free model with its
 * capabilities, base URL, and optional authentication.
 */
export interface FreeModelEntry {
  /** Unique identifier (e.g., "nvidia-nim-llama-3.1-8b"). */
  id: string;
  /** Display name. */
  name: string;
  /** Provider source (e.g., "nvidia-nim", "openrouter-free", "huggingface"). */
  source: string;
  /** OpenAI-compatible base URL for the model. */
  baseUrl: string;
  /** Model identifier to send in API requests. */
  modelId: string;
  /** Capabilities this model supports. */
  capabilities: ModelCapability[];
  /** Maximum context window in tokens. */
  maxTokens: number;
  /** Optional API key env var name (some free tiers require registration). */
  apiKeyEnv?: string;
  /** Whether this endpoint is enabled (default: true). */
  enabled: boolean;
  /** Stability score (0-100) computed from health check history. */
  stabilityScore?: number;
  /** ISO timestamp of last stability score computation. */
  lastStabilityCheck?: string;
}

/**
 * External model definition from a catalog source (e.g., free-coding-models).
 *
 * Maps the [model_id, display_label, tier, swe_score, ctx] tuple format
 * used in sources.js into a typed structure.
 */
export interface ExternalModelDef {
  /** API model identifier string. */
  modelId: string;
  /** Human-readable display label. */
  displayName: string;
  /** Performance tier (S+, S, A+, A, A-, B+, B, C). */
  tier: string;
  /** SWE-bench verified percentage (0-100). */
  sweScore: number;
  /** Context window string (e.g., "128k", "1M"). */
  contextWindow: string;
}

/**
 * Provider definition from a catalog source.
 */
export interface CatalogProvider {
  /** Provider source key (e.g., "nvidia", "groq"). */
  sourceKey: string;
  /** OpenAI-compatible base URL. */
  baseUrl: string;
  /** Environment variable name for API key. */
  envKey?: string;
  /** Models available from this provider. */
  models: ExternalModelDef[];
}

/**
 * Full catalog structure loaded from catalog.json.
 */
export interface ModelCatalog {
  /** Catalog version string. */
  version: string;
  /** ISO timestamp of catalog generation. */
  generatedAt: string;
  /** Source attribution. */
  source: string;
  /** Provider entries. */
  providers: CatalogProvider[];
}

/**
 * Health check result for a single model endpoint.
 */
export interface HealthCheckResult {
  /** Model entry ID. */
  modelId: string;
  /** Current health status. */
  status: HealthStatus;
  /** Measured latency in ms (null if unreachable). */
  latencyMs: number | null;
  /** Timestamp of last successful check (ISO). */
  lastChecked: string;
  /** Error message if check failed. */
  error?: string;
}

/**
 * Ranked free model with scoring metadata.
 */
export interface RankedFreeModel {
  /** The model entry. */
  entry: FreeModelEntry;
  /** Health check result. */
  health: HealthCheckResult;
  /** Computed score (higher = better). 0-100 scale. */
  score: number;
  /** Score breakdown for observability. */
  breakdown: {
    latencyScore: number;
    reliabilityScore: number;
    capabilityScore: number;
  };
}

/**
 * Configuration for the free model routing system.
 */
export interface FreeModelConfig {
  /** Whether free model fallback is enabled. */
  enabled: boolean;
  /** Health check interval in seconds (default: 60). */
  healthCheckIntervalSec: number;
  /** Health check timeout in ms (default: 5000). */
  healthCheckTimeoutMs: number;
  /** Maximum number of models to try before giving up (default: 3). */
  maxRetries: number;
  /** Custom model entries (merged with defaults). */
  models: FreeModelEntry[];
}

/** Default free model config values. */
export const DEFAULT_FREE_MODEL_CONFIG: FreeModelConfig = {
  enabled: false,
  healthCheckIntervalSec: 60,
  healthCheckTimeoutMs: 5000,
  maxRetries: 3,
  models: [],
};
