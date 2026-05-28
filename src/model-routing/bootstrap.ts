/**
 * Model router bootstrap.
 *
 * Bridges the provider registry with the ModelRouter by mapping provider
 * instances to endpoints defined in the routing configuration.
 */

import { ModelRouter } from './router.js';
import { loadConfig } from './config.js';
import type { ModelRoutingConfig, ModelEndpoint } from './types.js';
import type { LLMProvider } from '../core/types.js';

/** Provider registry entry mapped to an endpoint. */
export interface MappedProvider {
  provider: LLMProvider;
  endpoint: ModelEndpoint;
}

/**
 * Create a ModelRouter instance from available providers and loaded config.
 *
 * @param providers - Map of provider ID → LLMProvider instance.
 * @param config    - Loaded ModelRoutingConfig (from loadConfig()).
 *
 * @returns A ModelRouter wired with available endpoints, or null if:
 *          - config is null
 *          - config.enabled is false
 *          - no providers map to any configured endpoint
 */
export function createModelRouter(
  providers: Map<string, LLMProvider>,
  config: ModelRoutingConfig | null,
): ModelRouter | null {
  if (!config || config.enabled === false) {
    return null;
  }

  // Map providers to endpoints: mark available only when provider exists
  const mappedEndpoints: ModelEndpoint[] = config.endpoints.map((endpoint) => {
    const provider = providers.get(endpoint.provider);
    return {
      ...endpoint,
      available: provider !== undefined,
    };
  });

  // If no endpoints have a matching provider, return null
  const anyAvailable = mappedEndpoints.some((e) => e.available);
  if (!anyAvailable) {
    return null;
  }

  const effectiveConfig: ModelRoutingConfig = {
    ...config,
    endpoints: mappedEndpoints,
  };

  return new ModelRouter(effectiveConfig);
}

/**
 * Bootstrap convenience: load config from disk and create router.
 *
 * @param providers - Array of registered LLMProvider instances.
 *
 * @returns A ModelRouter or null (same conditions as createModelRouter).
 */
export function bootstrapModelRouter(
  providers: LLMProvider[],
): ModelRouter | null {
  const providersMap = new Map(providers.map((p) => [p.id, p]));
  const config = loadConfig();
  return createModelRouter(providersMap, config);
}
