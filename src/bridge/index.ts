/**
 * Bridge module — task-aware cross-model routing.
 *
 * Exports the public API for heuristic-based task classification
 * and provider routing with fallback chains.
 */

export { BridgeOrchestrator } from './orchestrator.js';
export { loadBridgeConfig } from './config.js';
export { classify, estimateTokens } from './classifier.js';
export type {
  TaskType,
  BridgeConfig,
  BridgeConfigRaw,
  BridgeResponse,
  BridgeRoute,
  ClassifierConfig,
} from './types.js';
