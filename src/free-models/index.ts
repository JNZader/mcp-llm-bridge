/**
 * Free Model Routing module — public API.
 *
 * Provides free model discovery, health checking, ranking, and
 * fallback routing as a strategy for the LLM bridge.
 */

export { FreeModelRouter } from './router.js';
export { FreeModelRegistry, loadUserModels, BUILTIN_FREE_MODELS } from './registry.js';
export { HealthChecker, checkHealth } from './health.js';
export { rankModels, scoreLatency, scoreReliability, scoreCapability, computeScore } from './ranker.js';
export type {
  FreeModelEntry,
  FreeModelConfig,
  HealthCheckResult,
  HealthStatus,
  ModelCapability,
  RankedFreeModel,
} from './types.js';
export { DEFAULT_FREE_MODEL_CONFIG } from './types.js';
