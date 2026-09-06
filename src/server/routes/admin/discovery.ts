import type { Hono } from 'hono';
import type Database from 'better-sqlite3';

import { getLocalLLMUrls, resolveHfToken } from '../../../core/local-llm-env.js';
import { safeError } from '../../../core/safe-error.js';
import { localLLMEnabled } from '../../../core/runtime-flags.js';
import type { FreeModelRouter } from '../../../free-models/router.js';
import { loadCatalog, importCatalog } from '../../../free-models/registry.js';
import { getSlimLocalLLMStatus, type SlimLocalLLMStatus } from '../../../local-llm/status.js';
import { discoverModels } from '../../../model-discovery/discovery.js';

export interface AdminDiscoveryRouteDeps {
  db?: Database.Database;
  freeModelRouter?: FreeModelRouter;
}

export interface AdminDiscoveryServices {
  loadCatalog: typeof loadCatalog;
  importCatalog: typeof importCatalog;
  getSlimLocalLLMStatus: typeof getSlimLocalLLMStatus;
  discoverModels: typeof discoverModels;
}

const defaultDiscoveryServices: AdminDiscoveryServices = {
  loadCatalog, importCatalog, getSlimLocalLLMStatus, discoverModels,
};

export function registerAdminDiscoveryRoutes(
  app: Hono,
  deps: AdminDiscoveryRouteDeps,
  services: AdminDiscoveryServices = defaultDiscoveryServices,
): void {
  // Trusted application bindings only; never populated from request/config data.
  const { loadCatalog, importCatalog, getSlimLocalLLMStatus, discoverModels } = services;
  app.post('/v1/admin/catalog/refresh', (c) => {
    try {
      const { freeModelRouter } = deps;
      if (!freeModelRouter) {
        return c.json({ error: 'Free model router not configured', code: 'NOT_CONFIGURED' }, 404);
      }

      const catalog = loadCatalog();
      if (!catalog) {
        return c.json({ error: 'Failed to load catalog file', code: 'LOAD_FAILED' }, 500);
      }

      const entries = importCatalog(catalog, freeModelRouter.getHealthChecker());
      const registry = freeModelRouter.getRegistry();
      const imported = registry.importModels(entries);

      return c.json({
        ok: true,
        imported,
        catalogVersion: catalog.version,
        providers: catalog.providers.length,
        message: `Catalog refreshed: ${imported} models imported from ${catalog.providers.length} providers`,
      });
    } catch {
      return c.json({ error: safeError('INTERNAL_ERROR').message }, 500);
    }
  });

  app.post('/v1/admin/discover', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const hfToken = resolveHfToken(body['hfToken'] as string | undefined);
      const enabled = body['enabled'] === undefined ? true : body['enabled'] !== false;
      const localLLMStatus = await getSlimLocalLLMStatus(
        { enabled: localLLMEnabled(), ...getLocalLLMUrls() },
        localLLMEnabled()
          ? { forceRefresh: true }
          : { skipDetectionWhenDisabled: true },
      );

      const result = await discoverModels(
        {
          hfToken,
          enabled,
        },
        getLocalLLMUrls(),
        deps.db,
        { forceRefreshLocalDetection: true },
      );

      return c.json({
        ok: true,
        models: result.models,
        backendsScanned: result.backendsScanned,
        enrichedCount: result.enrichedCount,
        unenrichedCount: result.unenrichedCount,
        errors: projectDiscoveryErrors(result.errors),
        timestamp: result.timestamp,
        partial: result.partial,
        snapshotUsed: result.snapshotUsed,
        localLLMStatus: projectDiscoveryStatus(localLLMStatus),
      });
    } catch {
      return c.json({ error: safeError('INTERNAL_ERROR').message }, 500);
    }
  });
}

function projectDiscoveryErrors(errors: string[] | undefined): string[] | undefined {
  if (errors === undefined) return undefined;
  if (!Array.isArray(errors)) throw new TypeError('Invalid discovery diagnostics');
  // Count diagnostic slots without reading values, getters or coercion hooks.
  return Array.from({ length: errors.length }, () => safeError('INTERNAL_ERROR').message);
}

function projectDiscoveryStatus(status: SlimLocalLLMStatus): SlimLocalLLMStatus {
  return {
    enabled: status.enabled,
    ready: status.ready,
    readyReason: status.readyReason,
    checkedAt: status.checkedAt,
    source: status.source,
    cacheHit: status.cacheHit,
    backendCount: status.backendCount,
    connectedBackendCount: status.connectedBackendCount,
    disconnectedBackendCount: status.disconnectedBackendCount,
    errorBackendCount: status.errorBackendCount,
    modelCount: status.modelCount,
    backends: status.backends.map((backend) => {
      const diagnostic = Object.getOwnPropertyDescriptor(backend, 'error');
      const hasDiagnostic = diagnostic !== undefined
        && ('get' in diagnostic || diagnostic.value !== undefined);
      return {
        backend: backend.backend,
        status: backend.status,
        baseUrl: backend.baseUrl,
        modelCount: backend.modelCount,
        models: backend.models.map((model) => ({
          id: model.id,
          name: model.name,
          loaded: model.loaded,
          parameterSize: model.parameterSize,
          contextWindow: model.contextWindow,
        })),
        error: hasDiagnostic ? safeError('INTERNAL_ERROR').message : undefined,
      };
    }),
  };
}
