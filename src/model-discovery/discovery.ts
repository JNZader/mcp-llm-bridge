/**
 * Model discovery — scan local runtimes and enrich with HuggingFace metadata.
 *
 * Orchestrates the full discovery flow:
 * 1. Detect local models (Ollama/LM Studio)
 * 2. Resolve local model IDs to HuggingFace repo IDs
 * 3. Fetch HF metadata for enrichment
 * 4. Recommend capabilities and routing config
 */

import type { LocalLLMConfig } from '../local-llm/types.js';
import type { CostTier } from '../model-routing/types.js';
import { COST_TIER } from '../model-routing/types.js';
import { detectLocalLLMs } from '../local-llm/detector.js';
import { HFClient } from './hf-client.js';
import { resolveHFModelId, inferCapabilities, recommendTasks } from './resolver.js';
import type { EnrichedModel, DiscoveryResult, ModelDiscoveryConfig } from './types.js';
import { DEFAULT_DISCOVERY_CONFIG } from './types.js';

/**
 * Run a full model discovery scan.
 *
 * Detects local models, enriches them with HF metadata,
 * and returns routing recommendations.
 */
export async function discoverModels(
  discoveryConfig?: Partial<ModelDiscoveryConfig>,
  llmConfig?: Partial<LocalLLMConfig>,
): Promise<DiscoveryResult> {
  const config = { ...DEFAULT_DISCOVERY_CONFIG, ...discoveryConfig };
  const hfClient = new HFClient(config);
  const errors: string[] = [];

  // 1. Detect local models
  const detections = await detectLocalLLMs(llmConfig);
  const backendsScanned = detections.map((d) => d.backend);

  // Collect all local models
  const localModels = detections.flatMap((d) => {
    if (d.error) errors.push(`${d.backend}: ${d.error}`);
    return d.models;
  });

  // 2. Enrich each model with HF metadata
  const enrichedModels: EnrichedModel[] = [];
  let enrichedCount = 0;
  let unenrichedCount = 0;

  for (const local of localModels) {
    const resolvedHfId = resolveHFModelId(local.id);
    let hfMetadata = null;

    if (resolvedHfId) {
      try {
        hfMetadata = await hfClient.fetchMetadata(resolvedHfId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`HF metadata fetch failed for ${resolvedHfId}: ${msg}`);
      }
    }

    // Infer capabilities from HF metadata or model name
    const capabilities = hfMetadata
      ? inferCapabilities(hfMetadata.tags, hfMetadata.pipelineTag)
      : inferCapabilitiesFromName(local.id);

    const recommendedCostTier = determineLocalCostTier(local.parameterSize);
    const recommendedTasks = recommendTasks(capabilities, local.parameterSize);

    enrichedModels.push({
      local,
      hfMetadata,
      resolvedHfId,
      capabilities,
      recommendedCostTier,
      recommendedTasks,
    });

    if (hfMetadata) enrichedCount++;
    else unenrichedCount++;
  }

  return {
    models: enrichedModels,
    backendsScanned,
    enrichedCount,
    unenrichedCount,
    timestamp: new Date().toISOString(),
    errors,
  };
}

/**
 * Infer capabilities from a model name when HF metadata unavailable.
 * Fallback heuristic based on common naming patterns.
 */
function inferCapabilitiesFromName(modelId: string): string[] {
  const lower = modelId.toLowerCase();
  const capabilities: string[] = ['chat']; // assume all models can chat

  if (lower.includes('code') || lower.includes('coder') || lower.includes('starcoder')) {
    capabilities.push('code');
  }
  if (lower.includes('embed')) {
    capabilities.push('embedding');
  }
  if (lower.includes('math') || lower.includes('reason')) {
    capabilities.push('reasoning');
  }

  return capabilities;
}

/**
 * Determine cost tier for a local model based on parameter size.
 * All local models are "free" in terms of API cost, but larger
 * models have higher compute cost.
 */
function determineLocalCostTier(parameterSize?: number): CostTier {
  // All local models are free (no API cost)
  return COST_TIER.FREE;
}
