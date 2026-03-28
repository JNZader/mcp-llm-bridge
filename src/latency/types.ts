/**
 * Latency types — TypeScript interfaces for latency measurement.
 *
 * Defines the measurement data structures and provider configuration
 * used by the LatencyMeasurer and router integration.
 */

/**
 * A single latency measurement for a provider endpoint.
 */
export interface LatencyMeasurement {
  /** Provider identifier (e.g., 'openai', 'anthropic') */
  provider: string;
  /** URL that was measured */
  url: string;
  /** Latency in milliseconds */
  latencyMs: number;
  /** Timestamp when measurement was taken (Date.now()) */
  measuredAt: number;
}

/**
 * Provider configuration for latency measurement.
 */
export interface ProviderConfig {
  /** Provider identifier */
  id: string;
  /** Base URL for the provider API */
  baseUrl?: string;
}

/**
 * Candidate provider with latency information for router selection.
 */
export interface ProviderCandidate {
  /** Provider identifier */
  provider: string;
  /** Provider weight/score for routing decisions */
  weight?: number;
}

/**
 * Latency measurement result with optional error.
 */
export interface MeasurementResult {
  /** Whether the measurement succeeded */
  success: boolean;
  /** Latency in milliseconds (null if failed) */
  latencyMs: number | null;
  /** Error message if measurement failed */
  error?: string;
}
