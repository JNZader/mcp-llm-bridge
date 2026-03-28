/**
 * Latency module — Smart latency-based provider selection.
 *
 * Exports the LatencyMeasurer for background measurement and
 * selector functions for router integration.
 *
 * @example
 * ```typescript
 * import { LatencyMeasurer, selectProviderWithLatency } from './latency/index.js';
 *
 * const measurer = new LatencyMeasurer();
 * measurer.startBackgroundTask([
 *   { id: 'openai', baseUrl: 'https://api.openai.com' },
 *   { id: 'anthropic', baseUrl: 'https://api.anthropic.com' },
 * ]);
 *
 * // Later, in router:
 * const measurements = measurer.getAll();
 * const latencyMap = buildLatencyMap(measurements);
 * const selected = selectProviderWithLatency(candidates, latencyMap, roundRobinIndex);
 * ```
 */

export {
  LatencyMeasurer,
  createLatencyMeasurer,
  DEFAULT_TTL_MS,
  DEFAULT_INTERVAL_MS,
  MEASUREMENT_TIMEOUT_MS,
} from './measurer.js';

export {
  selectProviderWithLatency,
  measurementsToMap,
  buildLatencyMap,
  hasLatencyData,
  getLatencyStats,
  SIMILAR_LATENCY_THRESHOLD,
} from './selector.js';

export type {
  LatencyMeasurement,
  ProviderConfig,
  ProviderCandidate,
  MeasurementResult,
} from './types.js';
