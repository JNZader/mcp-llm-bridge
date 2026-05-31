/**
 * Local LLM detector — probe Ollama and LM Studio for available models.
 *
 * Checks local endpoints for running LLM runtimes, discovers
 * available models, and reports connection status. Designed for
 * graceful degradation — a missing runtime is NOT an error.
 */

import type {
  LocalLLMBackend,
  LocalLLMConfig,
  DetectionResult,
  LocalModel,
  LocalLLMStatus,
  LocalLLMStatusBackend,
  LocalLLMStatusSource,
} from './types.js';
import { DEFAULT_LOCAL_LLM_CONFIG, LOCAL_LLM_STATUS_SOURCE } from './types.js';

const DEFAULT_SUCCESS_CACHE_TTL_MS = 5000;
const DEFAULT_FAILURE_CACHE_TTL_MS = 1500;

interface LocalLLMDetectionCacheEntry {
  expiresAt: number;
  results?: DetectionResult[];
  inFlight?: Promise<DetectionResult[]>;
}

export interface DetectLocalLLMsOptions {
  forceRefresh?: boolean;
  successCacheTtlMs?: number;
  failureCacheTtlMs?: number;
}

export interface GetLocalLLMStatusOptions extends DetectLocalLLMsOptions {
  skipDetectionWhenDisabled?: boolean;
}

const detectionCache = new Map<string, LocalLLMDetectionCacheEntry>();

/**
 * Raw Ollama model entry from /api/tags response.
 */
interface OllamaModelEntry {
  name: string;
  size?: number;
  details?: {
    parameter_size?: string;
    family?: string;
  };
}

/**
 * Raw LM Studio model entry from /v1/models response.
 */
interface LMStudioModelEntry {
  id: string;
  object?: string;
}

function getCacheKey(config: LocalLLMConfig): string {
  return JSON.stringify({
    ollamaUrl: config.ollamaUrl,
    lmStudioUrl: config.lmStudioUrl,
    connectionTimeoutMs: config.connectionTimeoutMs,
  });
}

function hasAvailableModels(results: DetectionResult[]): boolean {
  return results.some((result) => result.status === 'connected' && result.models.length > 0);
}

function getStatusSource(
  config: LocalLLMConfig,
  options?: DetectLocalLLMsOptions,
): LocalLLMStatusSource {
  if (options?.forceRefresh) {
    return LOCAL_LLM_STATUS_SOURCE.PROBE;
  }

  const cached = detectionCache.get(getCacheKey(config));
  const now = Date.now();

  if (cached?.results && cached.expiresAt > now) {
    return LOCAL_LLM_STATUS_SOURCE.CACHE;
  }

  if (cached?.inFlight) {
    return LOCAL_LLM_STATUS_SOURCE.IN_FLIGHT;
  }

  return LOCAL_LLM_STATUS_SOURCE.PROBE;
}

function buildDisabledDetectionResults(config: LocalLLMConfig): DetectionResult[] {
  return [
    {
      backend: 'ollama',
      status: 'disconnected',
      baseUrl: config.ollamaUrl,
      models: [],
      error: 'Detection skipped because local LLM is disabled',
    },
    {
      backend: 'lm-studio',
      status: 'disconnected',
      baseUrl: config.lmStudioUrl,
      models: [],
      error: 'Detection skipped because local LLM is disabled',
    },
  ];
}

function buildLocalLLMStatus(
  config: LocalLLMConfig,
  results: DetectionResult[],
  source: LocalLLMStatusSource,
): LocalLLMStatus {
  const backends: LocalLLMStatusBackend[] = results.map((result) => ({
    ...result,
    modelCount: result.models.length,
  }));
  const connectedBackendCount = backends.filter((backend) => backend.status === 'connected').length;
  const modelCount = backends.reduce((total, backend) => total + backend.modelCount, 0);

  return {
    enabled: config.enabled,
    ready: config.enabled && modelCount > 0,
    checkedAt: new Date().toISOString(),
    source,
    cacheHit: source === LOCAL_LLM_STATUS_SOURCE.CACHE,
    backendCount: backends.length,
    connectedBackendCount,
    modelCount,
    backends,
  };
}

async function runDetections(config: LocalLLMConfig): Promise<DetectionResult[]> {
  const probeInputs = [
    { backend: 'ollama' as const, baseUrl: config.ollamaUrl },
    { backend: 'lm-studio' as const, baseUrl: config.lmStudioUrl },
  ];

  const probes = await Promise.allSettled(
    probeInputs.map(({ backend, baseUrl }) => probeBackend(backend, baseUrl, config.connectionTimeoutMs)),
  );

  return probes.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;

    const probe = probeInputs[index]!;
    return {
      backend: probe.backend,
      status: 'error' as const,
      baseUrl: probe.baseUrl,
      models: [],
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });
}

/**
 * Probe a single backend for availability and models.
 */
async function probeBackend(
  backend: LocalLLMBackend,
  baseUrl: string,
  timeoutMs: number,
): Promise<DetectionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = backend === 'ollama'
      ? `${baseUrl}/api/tags`
      : `${baseUrl}/v1/models`;

    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      return {
        backend,
        status: 'error',
        baseUrl,
        models: [],
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const body = await response.json() as Record<string, unknown>;
    const models = backend === 'ollama'
      ? parseOllamaModels(body)
      : parseLMStudioModels(body, backend);

    return { backend, status: 'connected', baseUrl, models };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = message.includes('abort');

    return {
      backend,
      status: 'disconnected',
      baseUrl,
      models: [],
      error: isTimeout ? 'Connection timed out' : message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse Ollama /api/tags response into LocalModel[].
 */
function parseOllamaModels(body: Record<string, unknown>): LocalModel[] {
  const models = body['models'];
  if (!Array.isArray(models)) return [];

  return models.map((m: OllamaModelEntry) => {
    const paramStr = m.details?.parameter_size ?? '';
    const paramSize = parseParameterSize(paramStr);

    return {
      id: m.name,
      name: m.name,
      backend: 'ollama' as const,
      parameterSize: paramSize,
      loaded: true, // listed models are pulled
    };
  });
}

/**
 * Parse LM Studio /v1/models response into LocalModel[].
 */
function parseLMStudioModels(
  body: Record<string, unknown>,
  _backend: LocalLLMBackend,
): LocalModel[] {
  const data = body['data'];
  if (!Array.isArray(data)) return [];

  return data.map((m: LMStudioModelEntry) => ({
    id: m.id,
    name: m.id,
    backend: 'lm-studio' as const,
    loaded: true,
  }));
}

/**
 * Parse parameter size string (e.g., "7B", "3.2B") into number.
 */
export function parseParameterSize(sizeStr: string): number | undefined {
  const match = sizeStr.match(/([\d.]+)\s*[bB]/);
  if (!match?.[1]) return undefined;
  return parseFloat(match[1]);
}

/**
 * Detect all available local LLM runtimes.
 *
 * Probes Ollama and LM Studio in parallel. Returns results for
 * all backends — caller decides which to use.
 */
export async function detectLocalLLMs(
  config?: Partial<LocalLLMConfig>,
  options?: DetectLocalLLMsOptions,
): Promise<DetectionResult[]> {
  const cfg = { ...DEFAULT_LOCAL_LLM_CONFIG, ...config };
  const cacheKey = getCacheKey(cfg);
  const now = Date.now();
  const cached = detectionCache.get(cacheKey);

  if (!options?.forceRefresh && cached?.results && cached.expiresAt > now) {
    return cached.results;
  }

  if (cached?.inFlight) {
    return cached.inFlight;
  }

  const inFlight = runDetections(cfg)
    .then((results) => {
      const ttlMs = hasAvailableModels(results)
        ? (options?.successCacheTtlMs ?? DEFAULT_SUCCESS_CACHE_TTL_MS)
        : (options?.failureCacheTtlMs ?? DEFAULT_FAILURE_CACHE_TTL_MS);

      detectionCache.set(cacheKey, {
        results,
        expiresAt: Date.now() + ttlMs,
      });

      return results;
    })
    .finally(() => {
      const current = detectionCache.get(cacheKey);
      if (current?.inFlight === inFlight) {
        detectionCache.set(cacheKey, {
          results: current.results,
          expiresAt: current.expiresAt,
        });
      }
    });

  detectionCache.set(cacheKey, {
    results: cached?.results,
    expiresAt: cached?.expiresAt ?? 0,
    inFlight,
  });

  return inFlight;
}

export async function getLocalLLMStatus(
  config?: Partial<LocalLLMConfig>,
  options?: GetLocalLLMStatusOptions,
): Promise<LocalLLMStatus> {
  const cfg = { ...DEFAULT_LOCAL_LLM_CONFIG, ...config };

  if (!cfg.enabled && options?.skipDetectionWhenDisabled) {
    return buildLocalLLMStatus(
      cfg,
      buildDisabledDetectionResults(cfg),
      LOCAL_LLM_STATUS_SOURCE.DISABLED,
    );
  }

  const source = getStatusSource(cfg, options);
  const results = await detectLocalLLMs(cfg, options);
  return buildLocalLLMStatus(cfg, results, source);
}

export function resetLocalLLMDetectionCache(): void {
  detectionCache.clear();
}

/**
 * Get the best available local model from detection results.
 *
 * Prefers Ollama over LM Studio. Picks the first connected
 * backend with available models.
 */
export function pickBestLocalModel(
  results: DetectionResult[],
  preferredModel?: string,
): LocalModel | null {
  const connected = results.filter((r) => r.status === 'connected' && r.models.length > 0);
  if (connected.length === 0) return null;

  // If preferred model is specified, search across all backends
  if (preferredModel) {
    for (const result of connected) {
      const found = result.models.find((m) => m.id === preferredModel);
      if (found) return found;
    }
  }

  // Default: first model from first connected backend
  const first = connected[0]!;
  return first.models[0] ?? null;
}
