/**
 * Model discovery — types and interfaces.
 *
 * Auto-discover local models with HuggingFace metadata enrichment.
 * Detects Ollama/LM Studio models, fetches HF metadata, and
 * recommends optimal routing configurations.
 */

import type { LocalModel, LocalLLMBackend } from '../local-llm/types.js';
import type { CostTier } from '../model-routing/types.js';

/**
 * HuggingFace model metadata fetched from the API.
 */
export interface HFModelMetadata {
  /** HuggingFace model ID (e.g., "meta-llama/Llama-3.2-3B"). */
  hfModelId: string;
  /** Model author/organization. */
  author: string;
  /** Number of downloads. */
  downloads: number;
  /** Number of likes. */
  likes: number;
  /** Pipeline tag (e.g., "text-generation"). */
  pipelineTag?: string;
  /** Model tags (e.g., ["llama", "conversational"]). */
  tags: string[];
  /** License identifier. */
  license?: string;
  /** Whether this is a gated model. */
  gated: boolean;
  /** Last modified ISO date. */
  lastModified?: string;
  /** Library name (e.g., "transformers", "gguf"). */
  libraryName?: string;
}

/**
 * An enriched local model with HuggingFace metadata.
 */
export interface EnrichedModel {
  /** Original local model info. */
  local: LocalModel;
  /** Matched HuggingFace metadata (null if no match found). */
  hfMetadata: HFModelMetadata | null;
  /** Resolved HuggingFace model ID used for lookup. */
  resolvedHfId: string | null;
  /** Recommended capabilities based on metadata. */
  capabilities: string[];
  /** Recommended cost tier for routing. */
  recommendedCostTier: CostTier;
  /** Recommended task types this model handles well. */
  recommendedTasks: string[];
}

/**
 * Result of a discovery scan.
 */
export interface DiscoveryResult {
  /** All enriched models found. */
  models: EnrichedModel[];
  /** Backends that were scanned. */
  backendsScanned: LocalLLMBackend[];
  /** Number of models with HF metadata. */
  enrichedCount: number;
  /** Number of models without HF metadata. */
  unenrichedCount: number;
  /** Scan timestamp. */
  timestamp: string;
  /** Errors encountered during scan. */
  errors: string[];
}

/**
 * Configuration for model discovery.
 */
export interface ModelDiscoveryConfig {
  /** Whether auto-discovery is enabled. */
  enabled: boolean;
  /** HuggingFace API base URL. */
  hfApiUrl: string;
  /** Optional HuggingFace API token for gated models. */
  hfToken?: string;
  /** Request timeout for HF API calls in ms (default: 5000). */
  hfTimeoutMs: number;
  /** Cache TTL for HF metadata in seconds (default: 3600). */
  cacheTtlSec: number;
}

/** Default model discovery configuration. */
export const DEFAULT_DISCOVERY_CONFIG: ModelDiscoveryConfig = {
  enabled: true,
  hfApiUrl: 'https://huggingface.co/api',
  hfTimeoutMs: 5000,
  cacheTtlSec: 3600,
};
