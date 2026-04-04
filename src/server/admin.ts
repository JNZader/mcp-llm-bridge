/**
 * Admin API — Dashboard management endpoints for the LLM Gateway.
 *
 * Provides unified overview, provider details, extended health checks,
 * and admin operations (circuit breaker reset, usage flush).
 *
 * All routes are mounted under /v1/admin/* and require authentication.
 * Supports a separate ADMIN_TOKEN env var for elevated access.
 */

import type { Hono, Context, Next } from 'hono';
import type Database from 'better-sqlite3';
import type { Router } from '../core/router.js';
import type { Vault } from '../vault/vault.js';
import type { GroupStore } from '../core/groups.js';
import type { CostTracker } from '../core/cost-tracker.js';
import type { GatewayConfig } from '../core/types.js';
import { timingSafeEqual } from 'node:crypto';
import { getCircuitBreakerRegistry, CircuitState } from '../core/circuit-breaker.js';
import { VERSION } from '../core/constants.js';
import { z } from 'zod';
import { ToolCategorySchema, TrustLevelSchema } from '../security/profiles.js';
import { loadCatalog, importCatalog } from '../free-models/registry.js';

// ── Admin Auth Middleware ─────────────────────────────────

/**
 * Timing-safe comparison for bearer tokens.
 */
function tokenEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Admin auth middleware.
 *
 * - If ADMIN_TOKEN env var is set, admin routes require THAT token.
 * - If ADMIN_TOKEN is not set, falls back to the regular AUTH_TOKEN.
 * - If neither is set, auth is disabled (local dev).
 */
export function adminAuth(config: GatewayConfig) {
  return async (c: Context, next: Next) => {
    // Read ADMIN_TOKEN at request time (not at init) so it can be changed dynamically
    const adminToken = process.env['ADMIN_TOKEN'];
    const requiredToken = adminToken ?? config.authToken;

    // No token configured → auth disabled (local dev)
    if (!requiredToken) {
      return next();
    }

    // CORS preflight must pass through
    if (c.req.method === 'OPTIONS') {
      return next();
    }

    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    if (!tokenEquals(parts[1], requiredToken)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return next();
  };
}

// ── Admin Route Registration ──────────────────────────────

export interface AdminDeps {
  router: Router;
  vault: Vault;
  config: GatewayConfig;
  groupStore?: GroupStore;
  costTracker?: CostTracker;
  serverStartTime: number;
  db?: Database.Database;
  /** Optional free model router for catalog operations. */
  freeModelRouter?: import('../free-models/router.js').FreeModelRouter;
}

/**
 * Register all /v1/admin/* routes on the Hono app.
 */
export function registerAdminRoutes(app: Hono, deps: AdminDeps): void {
  const { router, config, groupStore, costTracker, serverStartTime } = deps;

  // Admin auth middleware for all /v1/admin/* routes
  app.use('/v1/admin/*', adminAuth(config));

  // ── GET /v1/admin/overview ─────────────────────────────

  app.get('/v1/admin/overview', async (c) => {
    try {
      // Providers
      const providers = await router.getProviderStatuses();

      // Groups
      const groups = groupStore ? groupStore.list() : [];

      // Circuit breakers
      const cbRegistry = getCircuitBreakerRegistry();
      const cbStats = cbRegistry.getAllStats();
      const cbSummary = {
        total: cbStats.length,
        open: cbStats.filter((s) => s.state === CircuitState.OPEN).length,
        closed: cbStats.filter((s) => s.state === CircuitState.CLOSED).length,
        halfOpen: cbStats.filter((s) => s.state === CircuitState.HALF_OPEN).length,
      };

      // Usage — last 24h summary
      let usage = { totalRequests: 0, totalCost: 0, totalTokens: 0 };
      if (costTracker) {
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const summary = costTracker.summary({
          from: oneDayAgo.toISOString(),
          to: now.toISOString(),
        });
        usage = {
          totalRequests: summary.totalRequests,
          totalCost: summary.totalCostUsd,
          totalTokens: summary.totalTokensIn + summary.totalTokensOut,
        };
      }

      // System info
      const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);

      return c.json({
        providers: providers.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          available: p.available,
        })),
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          memberCount: g.members.length,
          strategy: g.strategy,
          modelPattern: g.modelPattern,
        })),
        circuitBreakers: cbSummary,
        usage,
        system: {
          uptime: uptimeSeconds,
          version: VERSION,
          mode: 'HTTP',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  // ── GET /v1/admin/providers ────────────────────────────

  app.get('/v1/admin/providers', async (c) => {
    try {
      const providers = await router.getProviderStatuses();
      const cbRegistry = getCircuitBreakerRegistry();
      const cbStats = cbRegistry.getAllStats();

      // Build a map of circuit breaker state by provider
      const cbByProvider = new Map<string, { state: string; failures: number; consecutiveFailures: number }>();
      for (const stat of cbStats) {
        cbByProvider.set(stat.name, {
          state: stat.state,
          failures: stat.failures,
          consecutiveFailures: stat.consecutiveFailures,
        });
      }

      const detailed = providers.map((p) => {
        const cb = cbByProvider.get(p.id);

        // Get provider models from router
        const models = router.getProviderModels(p.id);

        return {
          id: p.id,
          name: p.name,
          type: p.type,
          available: p.available,
          models,
          circuitBreaker: cb ?? { state: 'CLOSED', failures: 0, consecutiveFailures: 0 },
        };
      });

      return c.json({ providers: detailed });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  // ── GET /v1/admin/health ───────────────────────────────

  app.get('/v1/admin/health', async (c) => {
    try {
      const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);
      const providers = await router.getProviderStatuses();
      const availableCount = providers.filter((p) => p.available).length;
      const memUsage = process.memoryUsage();

      return c.json({
        status: 'ok',
        database: { connected: true },
        providers: {
          available: availableCount,
          total: providers.length,
        },
        uptime: uptimeSeconds,
        version: VERSION,
        memory: {
          rss: memUsage.rss,
          heapTotal: memUsage.heapTotal,
          heapUsed: memUsage.heapUsed,
          external: memUsage.external,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({
        status: 'error',
        error: message,
        database: { connected: false },
      }, 500);
    }
  });

  // ── POST /v1/admin/reset-circuit-breaker/:provider ────

  app.post('/v1/admin/reset-circuit-breaker/:provider', (c) => {
    try {
      const provider = c.req.param('provider');
      const cbRegistry = getCircuitBreakerRegistry();

      // Check if breaker exists
      const stats = cbRegistry.getAllStats();
      const found = stats.find((s) => s.name === provider);

      if (!found) {
        return c.json({ error: `No circuit breaker found for: ${provider}`, code: 'NOT_FOUND' }, 404);
      }

      // Reset by forcing to CLOSED state
      const breaker = cbRegistry.get(provider);
      breaker.forceState(CircuitState.CLOSED);

      return c.json({
        ok: true,
        provider,
        state: 'CLOSED',
        message: `Circuit breaker for ${provider} has been reset`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  // ── POST /v1/admin/flush-usage ─────────────────────────

  app.post('/v1/admin/flush-usage', (c) => {
    try {
      if (!costTracker) {
        return c.json({ error: 'Cost tracker not configured', code: 'NOT_CONFIGURED' }, 404);
      }

      const bufferBefore = costTracker.bufferSize;
      costTracker.flush();
      const bufferAfter = costTracker.bufferSize;

      return c.json({
        ok: true,
        flushed: bufferBefore - bufferAfter,
        remainingBuffer: bufferAfter,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  // ── Security Profile CRUD Routes (Phase 5) ────────────────

  const CreateProfileSchema = z.object({
    project: z.string().min(1),
    trustLevel: TrustLevelSchema.optional().default('restricted'),
    allowedCategories: z.array(ToolCategorySchema).min(1),
    rateLimitMax: z.number().int().positive().nullable().optional().default(null),
    rateLimitWindowMs: z.number().int().positive().nullable().optional().default(null),
  });

  app.post('/v1/admin/profiles', async (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: 'Database not configured', code: 'NOT_CONFIGURED' }, 500);
      }

      const body = await c.req.json();
      const parsed = CreateProfileSchema.safeParse(body);

      if (!parsed.success) {
        return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
      }

      const { project, trustLevel, allowedCategories, rateLimitMax, rateLimitWindowMs } = parsed.data;

      const stmt = deps.db.prepare(`
        INSERT INTO security_profiles (project, trust_level, allowed_categories, rate_limit_max, rate_limit_window_ms, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(project) DO UPDATE SET
          trust_level = excluded.trust_level,
          allowed_categories = excluded.allowed_categories,
          rate_limit_max = excluded.rate_limit_max,
          rate_limit_window_ms = excluded.rate_limit_window_ms,
          updated_at = datetime('now')
      `);

      stmt.run(
        project,
        trustLevel,
        JSON.stringify(allowedCategories),
        rateLimitMax,
        rateLimitWindowMs,
      );

      return c.json({
        ok: true,
        project,
        trustLevel,
        allowedCategories,
        rateLimitMax,
        rateLimitWindowMs,
      }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  app.get('/v1/admin/profiles', (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: 'Database not configured', code: 'NOT_CONFIGURED' }, 500);
      }

      const rows = deps.db.prepare('SELECT * FROM security_profiles ORDER BY project').all() as Array<{
        id: number;
        project: string;
        trust_level: string;
        allowed_categories: string;
        rate_limit_max: number | null;
        rate_limit_window_ms: number | null;
        created_at: string;
        updated_at: string;
      }>;

      const profiles = rows.map((row) => ({
        id: row.id,
        project: row.project,
        trustLevel: row.trust_level,
        allowedCategories: JSON.parse(row.allowed_categories) as string[],
        rateLimitMax: row.rate_limit_max,
        rateLimitWindowMs: row.rate_limit_window_ms,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      return c.json({ profiles });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  app.delete('/v1/admin/profiles/:project', (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: 'Database not configured', code: 'NOT_CONFIGURED' }, 500);
      }

      const project = c.req.param('project');
      const result = deps.db.prepare('DELETE FROM security_profiles WHERE project = ?').run(project);

      if (result.changes === 0) {
        return c.json({ error: `No profile found for project "${project}"`, code: 'NOT_FOUND' }, 404);
      }

      return c.json({ ok: true, project, message: `Profile for "${project}" deleted` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  // ── POST /v1/admin/catalog/refresh ────────────────────────

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
}
