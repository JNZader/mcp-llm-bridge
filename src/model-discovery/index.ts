/**
 * Model Discovery Module
 *
 * Auto-discover local models with HuggingFace metadata enrichment.
 * Detects Ollama/LM Studio models, fetches metadata from HF,
 * and recommends optimal routing configurations.
 *
 * Re-exports all model discovery types and implementations.
 */

// Types
export {
  DEFAULT_DISCOVERY_CONFIG,
  type HFModelMetadata,
  type EnrichedModel,
  type DiscoveryResult,
  type ModelDiscoveryConfig,
} from './types.js';

// HF Client
export { HFClient } from './hf-client.js';

// Resolver
export {
  resolveHFModelId,
  inferCapabilities,
  recommendTasks,
} from './resolver.js';

// Discovery
export { discoverModels } from './discovery.js';
