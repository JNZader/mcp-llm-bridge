/**
 * Free Model Router — fallback routing through free model endpoints.
 *
 * Integrates with the main Router as a fallback strategy. When paid
 * providers fail or for low-priority tasks, routes to the best
 * available free model ranked by latency and reliability.
 *
 * Uses OpenAI-compatible chat completion endpoints (most free
 * providers expose this format).
 */

import { logger } from '../core/logger.js';
import type { GenerateRequest, GenerateResponse } from '../core/types.js';
import type { FreeModelEntry, FreeModelConfig, ModelCapability } from './types.js';
import { FreeModelRegistry, loadUserModels } from './registry.js';
import { HealthChecker } from './health.js';
import { rankModels } from './ranker.js';
import { DEFAULT_FREE_MODEL_CONFIG } from './types.js';

/**
 * FreeModelRouter — manages discovery, health-checking, and routing
 * to free model endpoints as a fallback strategy.
 */
export class FreeModelRouter {
  private readonly registry: FreeModelRegistry;
  private readonly healthChecker: HealthChecker;
  private readonly config: FreeModelConfig;

  constructor(config: Partial<FreeModelConfig> = {}) {
    this.config = { ...DEFAULT_FREE_MODEL_CONFIG, ...config };

    // Load user-defined models and merge with built-ins.
    // If explicit models are provided in config, use them as the full set
    // (no built-in merge — allows complete control).
    if (this.config.models.length > 0) {
      this.registry = new FreeModelRegistry(this.config.models, true);
    } else {
      const userModels = loadUserModels();
      this.registry = new FreeModelRegistry(userModels);
    }
    this.healthChecker = new HealthChecker(this.config.healthCheckTimeoutMs);

    if (this.config.enabled) {
      this.startHealthChecks();
    }
  }

  /** Start periodic health monitoring. */
  private startHealthChecks(): void {
    const enabled = this.registry.getEnabled();
    if (enabled.length === 0) {
      logger.warn('Free model routing enabled but no models registered');
      return;
    }

    logger.info(
      { modelCount: enabled.length, intervalSec: this.config.healthCheckIntervalSec },
      'Starting free model health checks',
    );

    this.healthChecker.startPeriodicChecks(
      enabled,
      this.config.healthCheckIntervalSec,
    );
  }

  /**
   * Attempt to generate a response using the best available free model.
   *
   * Ranks available models, then tries them in order until one succeeds
   * or maxRetries is exhausted.
   *
   * @param request Original generate request
   * @param requiredCapabilities Capabilities the request needs
   * @returns GenerateResponse from the free model, or throws if all fail
   */
  async generate(
    request: GenerateRequest,
    requiredCapabilities: ModelCapability[] = [],
  ): Promise<GenerateResponse> {
    const startTime = Date.now();
    const ranked = rankModels(
      this.registry.getEnabled(),
      this.healthChecker,
      requiredCapabilities,
    );

    if (ranked.length === 0) {
      throw new Error('No free models available (all down or none registered)');
    }

    const candidates = ranked.slice(0, this.config.maxRetries);
    const errors: string[] = [];

    for (const [index, candidate] of candidates.entries()) {
      try {
        const response = await this.callModel(candidate.entry, request);
        const latencyMs = Date.now() - startTime;

        logger.info(
          {
            model: candidate.entry.id,
            score: candidate.score,
            latencyMs,
            fallbackUsed: index > 0,
          },
          'Free model request succeeded',
        );

        return {
          text: response,
          provider: `free:${candidate.entry.source}`,
          model: candidate.entry.modelId,
          resolvedProvider: `free:${candidate.entry.source}`,
          resolvedModel: candidate.entry.modelId,
          fallbackUsed: index > 0,
          latencyMs,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          { model: candidate.entry.id, error: message },
          'Free model request failed, trying next',
        );
        errors.push(`${candidate.entry.id}: ${message}`);
        continue;
      }
    }

    throw new Error(
      `All free models failed (tried ${candidates.length}).\n${errors.join('\n')}`,
    );
  }

  /**
   * Call a single free model endpoint using OpenAI-compatible format.
   * Returns the generated text content.
   */
  private async callModel(entry: FreeModelEntry, request: GenerateRequest): Promise<string> {
    const apiKey = entry.apiKeyEnv ? process.env[entry.apiKeyEnv] : undefined;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // Build messages array from the request
    const messages: Array<{ role: string; content: string }> = [];

    if (request.system) {
      messages.push({ role: 'system', content: request.system });
    }

    messages.push({ role: 'user', content: request.prompt });

    const body = JSON.stringify({
      model: entry.modelId,
      messages,
      max_tokens: request.maxTokens ?? Math.min(entry.maxTokens, 4096),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(`${entry.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from free model');
      }

      return content;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Get the registry for inspection. */
  getRegistry(): FreeModelRegistry {
    return this.registry;
  }

  /** Get the health checker for inspection. */
  getHealthChecker(): HealthChecker {
    return this.healthChecker;
  }

  /** Whether the router is enabled and has models. */
  get isAvailable(): boolean {
    return this.config.enabled && this.registry.getEnabled().length > 0;
  }

  /** Clean up resources. */
  destroy(): void {
    this.healthChecker.destroy();
  }
}
