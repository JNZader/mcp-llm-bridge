/**
 * Local LLM Provider — LLMProvider adapter for local runtimes.
 *
 * Wraps `detectLocalLLMs` and `callLocalLLM` to present a unified
 * provider interface that the Router can use for offloading.
 */

import type { LLMProvider, ModelInfo, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { LocalLLMConfig, LocalModel } from './types.js';
import { DEFAULT_LOCAL_LLM_CONFIG } from './types.js';
import { detectLocalLLMs, pickBestLocalModel } from './detector.js';
import { callLocalLLM, LocalLLMError } from './client.js';
import { classifyForOffload, meetsOffloadThreshold } from './router.js';
import { logger } from '../core/logger.js';

export { LocalLLMError } from './client.js';

/**
 * Provider adapter that routes offloadable tasks to Ollama/LM Studio.
 *
 * Implements `LLMProvider` so it can be registered with the Router and
 * participate in normal candidate resolution, circuit breakers, and
 * fallback chains.
 */
export class LocalLLMProvider implements LLMProvider {
  readonly id = 'local-llm';
  readonly name = 'Local LLM (Ollama/LM Studio)';
  readonly type = 'api' as const;
  models: ModelInfo[] = [];

  private config: LocalLLMConfig;
  private detectionResults = new Map<string, LocalModel[]>();

  private getDetectionSnapshot(): Array<{
    backend: string;
    modelCount: number;
    modelIds: string[];
  }> {
    return Array.from(this.detectionResults.entries()).map(([backend, models]) => ({
      backend,
      modelCount: models.length,
      modelIds: models.map((model) => model.id),
    }));
  }

  constructor(config?: Partial<LocalLLMConfig>) {
    this.config = { ...DEFAULT_LOCAL_LLM_CONFIG, ...config };
  }

  /**
   * Refresh the model list by probing local backends.
   * Call this at bootstrap or when models change.
   */
  async refreshModels(): Promise<void> {
    if (!this.config.enabled) {
      this.models = [];
      this.detectionResults.clear();
      return;
    }

    const results = await detectLocalLLMs(this.config);
    const infos: ModelInfo[] = [];
    this.detectionResults.clear();

    for (const result of results) {
      if (result.status === 'connected') {
        this.detectionResults.set(result.backend, result.models);
        for (const m of result.models) {
          infos.push({
            id: m.id,
            name: m.name,
            provider: this.id,
            maxTokens: m.contextWindow ?? 4096,
          });
        }
      }
    }

    this.models = infos;
    const connectedBackends = this.getDetectionSnapshot();
    logger.info(
      {
        connectedBackendCount: connectedBackends.length,
        connectedBackends,
        modelCount: infos.length,
      },
      'Local LLM models refreshed',
    );
  }

  /** True if at least one local backend is connected. */
  async isAvailable(): Promise<boolean> {
    if (!this.config.enabled) return false;

    await this.refreshModels();

    return this.models.length > 0;
  }

  /**
   * Generate via local LLM.
   *
   * Throws `LocalLLMError` on failure so the Router can catch it and
   * fall back to the next candidate.
   */
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    if (!this.config.enabled) {
      throw new LocalLLMError('Local LLM is disabled', 'ollama');
    }

    // Re-sync through the shared detector cache so stale positive state expires.
    await this.refreshModels();

    if (this.models.length === 0) {
      throw new LocalLLMError('No local models available', 'ollama');
    }

    // Pick model: use request.model if it matches a local model, else best available
    let model: LocalModel | null = null;
    if (request.model) {
      model = pickBestLocalModel(
        Array.from(this.detectionResults.entries()).map(([backend, models]) => ({
          backend: backend as 'ollama' | 'lm-studio',
          status: 'connected' as const,
          baseUrl: '',
          models,
        })),
        request.model,
      );
    }
    if (!model) {
      model = pickBestLocalModel(
        Array.from(this.detectionResults.entries()).map(([backend, models]) => ({
          backend: backend as 'ollama' | 'lm-studio',
          status: 'connected' as const,
          baseUrl: '',
          models,
        })),
        this.config.preferredModel,
      );
    }

    if (!model) {
      throw new LocalLLMError('No suitable local model found', 'ollama');
    }

    // Classify task for offloading — if not offloadable, refuse
    const classification = classifyForOffload(request.prompt);
    if (!meetsOffloadThreshold(classification, this.config.minOffloadConfidence)) {
      throw new LocalLLMError(
        `Task not offloadable: ${classification.reason}`,
        model.backend,
      );
    }

    const response = await callLocalLLM(
      model,
      request.prompt,
      request.system,
      this.config,
    );

    return {
      text: response.text,
      provider: this.id,
      model: response.model,
      tokensUsed: response.tokensUsed,
      resolvedProvider: this.id,
      resolvedModel: response.model,
      fallbackUsed: false,
      latencyMs: response.latencyMs,
    };
  }
}
