import type { Hono } from 'hono';
import type Database from 'better-sqlite3';

import { getLocalLLMUrls, resolveHfToken } from '../../../core/local-llm-env.js';
import type { FreeModelRouter } from '../../../free-models/router.js';
import { loadCatalog, importCatalog } from '../../../free-models/registry.js';
import { discoverModels } from '../../../model-discovery/discovery.js';

export interface AdminDiscoveryRouteDeps {
  db?: Database.Database;
  freeModelRouter?: FreeModelRouter;
}

export function registerAdminDiscoveryRoutes(
  app: Hono,
  deps: AdminDiscoveryRouteDeps,
): void {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  app.post('/v1/admin/discover', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const hfToken = resolveHfToken(body['hfToken'] as string | undefined);

      const result = await discoverModels(
        {
          hfToken,
          enabled: true,
        },
        getLocalLLMUrls(),
        deps.db,
      );

      return c.json({
        ok: true,
        models: result.models,
        backendsScanned: result.backendsScanned,
        enrichedCount: result.enrichedCount,
        unenrichedCount: result.unenrichedCount,
        errors: result.errors,
        timestamp: result.timestamp,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
}
