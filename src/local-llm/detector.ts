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
} from './types.js';
import { DEFAULT_LOCAL_LLM_CONFIG } from './types.js';

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

/**
 * Probe a single backend for availability and models.
 */
async function probeBackend(
  backend: LocalLLMBackend,
  baseUrl: string,
  timeoutMs: number,
): Promise<DetectionResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const endpoint = backend === 'ollama'
      ? `${baseUrl}/api/tags`
      : `${baseUrl}/v1/models`;

    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    });

    clearTimeout(timer);

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
): Promise<DetectionResult[]> {
  const cfg = { ...DEFAULT_LOCAL_LLM_CONFIG, ...config };

  const probes = await Promise.allSettled([
    probeBackend('ollama', cfg.ollamaUrl, cfg.connectionTimeoutMs),
    probeBackend('lm-studio', cfg.lmStudioUrl, cfg.connectionTimeoutMs),
  ]);

  return probes.map((result) => {
    if (result.status === 'fulfilled') return result.value;
    return {
      backend: 'ollama' as LocalLLMBackend,
      status: 'error' as const,
      baseUrl: '',
      models: [],
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });
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
