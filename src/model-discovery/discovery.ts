/**
 * Model discovery — scan local runtimes and enrich with HuggingFace metadata.
 *
 * Orchestrates the full discovery flow:
 * 1. Detect local models (Ollama/LM Studio)
 * 2. Resolve local model IDs to HuggingFace repo IDs
 * 3. Fetch HF metadata for enrichment
 * 4. Recommend capabilities and routing config
 */

import { DEFAULT_LOCAL_LLM_CONFIG, type LocalLLMConfig } from '../local-llm/types.js';
import type { CostTier } from '../model-routing/types.js';
import { COST_TIER } from '../model-routing/types.js';
import { detectLocalLLMs, type DetectLocalLLMsOptions } from '../local-llm/detector.js';
import { HFClient } from './hf-client.js';
import { resolveHFModelId, inferCapabilities, recommendTasks } from './resolver.js';
import type { EnrichedModel, DiscoveryResult, ModelDiscoveryConfig } from './types.js';
import { DEFAULT_DISCOVERY_CONFIG } from './types.js';
import type Database from 'better-sqlite3';

const DISCOVERY_SNAPSHOT_KEY = 'local-llm';

export interface DiscoverModelsOptions {
  forceRefreshLocalDetection?: boolean;
}

const inFlightDiscoveries = new Map<string, Promise<DiscoveryResult>>();
const discoveryDbIds = new WeakMap<Database.Database, number>();
let nextDiscoveryDbId = 1;

/**
 * Run a full model discovery scan.
 *
 * Detects local models, enriches them with HF metadata,
 * and returns routing recommendations.
 */
export async function discoverModels(
  discoveryConfig?: Partial<ModelDiscoveryConfig>,
  llmConfig?: Partial<LocalLLMConfig>,
  db?: Database.Database,
  options?: DiscoverModelsOptions,
): Promise<DiscoveryResult> {
  const config = { ...DEFAULT_DISCOVERY_CONFIG, ...discoveryConfig };

  if (!config.enabled) {
    return loadSnapshotOrEmpty(db, 'Model discovery disabled by config');
  }

  const discoveryKey = getDiscoveryKey(config, llmConfig, db, options);
  const inFlightDiscovery = inFlightDiscoveries.get(discoveryKey);
  if (inFlightDiscovery) {
    return inFlightDiscovery;
  }

  const discoveryPromise = runDiscovery(config, llmConfig, db, {
    forceRefresh: options?.forceRefreshLocalDetection ?? true,
  }).finally(() => {
    inFlightDiscoveries.delete(discoveryKey);
  });

  inFlightDiscoveries.set(discoveryKey, discoveryPromise);
  return discoveryPromise;
}

async function runDiscovery(
  config: ModelDiscoveryConfig,
  llmConfig?: Partial<LocalLLMConfig>,
  db?: Database.Database,
  detectionOptions?: DetectLocalLLMsOptions,
): Promise<DiscoveryResult> {
  const hfClient = new HFClient(config, db);
  const errors: string[] = [];
  const deadlineAt = Date.now() + config.discoveryBudgetMs;

  let detections = [] as Awaited<ReturnType<typeof detectLocalLLMs>>;

  try {
    detections = await detectLocalLLMs(llmConfig, detectionOptions);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(`Local model detection failed: ${msg}`);
  }

  // 1. Detect local models
  const backendsScanned = detections.map((d) => d.backend);
  const liveBackendsAvailable = detections.some((d) => d.status === 'connected');

  // Collect all local models
  const localModels = detections.flatMap((d) => {
    if (d.error) errors.push(`${d.backend}: ${d.error}`);
    return d.models;
  });

  // 2. Enrich each model with HF metadata
  const enrichedModels: EnrichedModel[] = [];
  let enrichedCount = 0;
  let unenrichedCount = 0;
  let partial = false;
  let budgetExceeded = false;

  for (const local of localModels) {
    const resolvedHfId = resolveHFModelId(local.id);
    let hfMetadata = null;

    if (resolvedHfId && !budgetExceeded) {
      const remainingBudgetMs = deadlineAt - Date.now();
      if (remainingBudgetMs <= 0) {
        budgetExceeded = true;
        partial = true;
        errors.push(
          `Discovery budget exceeded after ${config.discoveryBudgetMs}ms; returning partial results`,
        );
      } else {
        const metadataResult = await hfClient.fetchMetadataWithStatus(resolvedHfId, {
          timeoutMs: Math.min(config.hfTimeoutMs, remainingBudgetMs),
          allowStale: true,
        });
        hfMetadata = metadataResult.metadata;
        if (metadataResult.error) {
          errors.push(metadataResult.error);
        }
        if (metadataResult.stale) {
          partial = true;
        }
      }
    }

    if (resolvedHfId && budgetExceeded) {
      partial = true;
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

  const liveResult: DiscoveryResult = {
    models: enrichedModels,
    backendsScanned,
    enrichedCount,
    unenrichedCount,
    timestamp: new Date().toISOString(),
    errors,
    partial,
    snapshotUsed: false,
  };

  if (liveBackendsAvailable) {
    saveSnapshot(db, liveResult);
    return liveResult;
  }

  if (localModels.length > 0) {
    saveSnapshot(db, liveResult);
    return liveResult;
  }

  if (errors.length > 0) {
    const snapshot = loadSnapshot(db);
    if (snapshot) {
      return {
        ...snapshot,
        errors: [...errors, `Using stale discovery snapshot from ${snapshot.timestamp}`],
        partial: true,
        snapshotUsed: true,
      };
    }

    return {
      ...liveResult,
      partial: true,
    };
  }

  return liveResult;
}

function getDiscoveryKey(
  config: ModelDiscoveryConfig,
  llmConfig?: Partial<LocalLLMConfig>,
  db?: Database.Database,
  options?: DiscoverModelsOptions,
): string {
  return JSON.stringify({
    config,
    llmConfig: { ...DEFAULT_LOCAL_LLM_CONFIG, ...llmConfig },
    dbId: getDiscoveryDbId(db),
    forceRefreshLocalDetection: options?.forceRefreshLocalDetection ?? true,
  });
}

function getDiscoveryDbId(db?: Database.Database): number | null {
  if (!db) {
    return null;
  }

  const existing = discoveryDbIds.get(db);
  if (existing) {
    return existing;
  }

  const created = nextDiscoveryDbId++;
  discoveryDbIds.set(db, created);
  return created;
}

function loadSnapshotOrEmpty(
  db: Database.Database | undefined,
  ...errors: string[]
): DiscoveryResult {
  const snapshot = loadSnapshot(db);
  if (!snapshot) {
    return createEmptyResult(errors);
  }

  return {
    ...snapshot,
    errors: [...errors, `Using stale discovery snapshot from ${snapshot.timestamp}`],
    partial: true,
    snapshotUsed: true,
  };
}

function loadSnapshot(db?: Database.Database): DiscoveryResult | null {
  if (!db) {
    return null;
  }

  try {
    const row = db
      .prepare(
        'SELECT snapshot_json FROM model_discovery_snapshots WHERE snapshot_key = ?',
      )
      .get(DISCOVERY_SNAPSHOT_KEY) as { snapshot_json: string } | undefined;
    if (!row) {
      return null;
    }

    const parsed = JSON.parse(row.snapshot_json) as Partial<DiscoveryResult>;
    return {
      models: parsed.models ?? [],
      backendsScanned: parsed.backendsScanned ?? [],
      enrichedCount: parsed.enrichedCount ?? 0,
      unenrichedCount: parsed.unenrichedCount ?? 0,
      timestamp: parsed.timestamp ?? new Date(0).toISOString(),
      errors: parsed.errors ?? [],
      partial: parsed.partial ?? false,
      snapshotUsed: true,
    };
  } catch {
    return null;
  }
}

function saveSnapshot(db: Database.Database | undefined, result: DiscoveryResult): void {
  if (!db) {
    return;
  }

  try {
    db.prepare(`
      INSERT INTO model_discovery_snapshots (snapshot_key, snapshot_json, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(snapshot_key) DO UPDATE SET
        snapshot_json = excluded.snapshot_json,
        updated_at = excluded.updated_at
    `).run(
      DISCOVERY_SNAPSHOT_KEY,
      JSON.stringify({ ...result, snapshotUsed: false }),
    );
  } catch {
    // Snapshot persistence is best-effort only.
  }
}

function createEmptyResult(errors: string[]): DiscoveryResult {
  return {
    models: [],
    backendsScanned: [],
    enrichedCount: 0,
    unenrichedCount: 0,
    timestamp: new Date().toISOString(),
    errors,
    partial: errors.length > 0,
    snapshotUsed: false,
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
function determineLocalCostTier(_parameterSize?: number): CostTier {
  // All local models are free (no API cost)
  return COST_TIER.FREE;
}
