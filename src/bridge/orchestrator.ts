/**
 * Bridge orchestrator — task-aware routing with fallback chain.
 *
 * Classifies incoming requests by heuristic, resolves the preferred
 * provider from bridge config, then delegates to the Router with
 * a fallback chain when the primary provider fails.
 */

import type { Router } from '../core/router.js';
import type { GenerateRequest } from '../core/types.js';
import type { BridgeConfig, BridgeResponse, TaskType } from './types.js';
import { classify } from './classifier.js';
import { logger } from '../core/logger.js';

/**
 * BridgeOrchestrator sits above the Router, adding task-aware routing.
 *
 * Flow:
 * 1. Classify prompt → taskType
 * 2. Resolve taskType → preferred provider via config
 * 3. Try preferred provider via Router
 * 4. On failure, try fallback_order providers sequentially
 * 5. Return normalized BridgeResponse
 */
export class BridgeOrchestrator {
  constructor(
    private readonly router: Router,
    private readonly config: BridgeConfig,
  ) {}

  /**
   * Generate text with task-aware routing.
   *
   * Classifies the prompt, picks the best provider, and falls back
   * through the configured chain on failure.
   */
  async generate(request: GenerateRequest): Promise<BridgeResponse> {
    const startTime = Date.now();
    const taskType = classify(request.prompt);

    // Resolve preferred provider from routes or default
    const preferredProvider = this.config.routes.get(taskType) ?? this.config.default;

    logger.info(
      { taskType, preferredProvider, prompt: request.prompt.slice(0, 80) },
      'Bridge: classified request',
    );

    // Build ordered provider list: preferred first, then fallback_order (deduped)
    const providerOrder = this.buildProviderOrder(preferredProvider);

    const errors: string[] = [];

    for (const [index, providerId] of providerOrder.entries()) {
      try {
        const result = await this.router.generate({
          ...request,
          provider: providerId,
        });

        const latencyMs = Date.now() - startTime;
        const fallbackUsed = index > 0;

        if (fallbackUsed) {
          logger.info(
            { taskType, preferredProvider, actualProvider: providerId },
            'Bridge: used fallback provider',
          );
        }

        return {
          text: result.text,
          provider: result.provider,
          model: result.model,
          taskType,
          fallbackUsed,
          latencyMs,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          { provider: providerId, error: message },
          'Bridge: provider failed, trying next',
        );
        errors.push(`${providerId}: ${message}`);
        continue;
      }
    }

    throw new Error(
      `Bridge: all providers failed for task type "${taskType}".\n${errors.join('\n')}`,
    );
  }

  /**
   * Build the ordered provider list for fallback chain.
   *
   * Puts the preferred provider first, then appends fallback_order
   * entries that aren't already in the list (deduplication).
   */
  private buildProviderOrder(preferredProvider: string): string[] {
    const order: string[] = [preferredProvider];
    const seen = new Set<string>([preferredProvider]);

    for (const provider of this.config.fallbackOrder) {
      if (!seen.has(provider)) {
        order.push(provider);
        seen.add(provider);
      }
    }

    return order;
  }
}
