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
import { createApiKey, revokeApiKey, listApiKeys } from '../auth/keys.js';

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
 * Accepts either:
 * - A GitHub OAuth JWT issued by this server (when GitHub OAuth is configured)
 * - The ADMIN_TOKEN env var (falls back to AUTH_TOKEN if ADMIN_TOKEN not set)
 * - Auth is disabled if neither is set (local dev).
 */
export function adminAuth(config: GatewayConfig) {
  return async (c: Context, next: Next) => {
    // CORS preflight must pass through
    if (c.req.method === 'OPTIONS') {
      return next();
    }

    const authHeader = c.req.header('Authorization');
    const parts = authHeader?.split(' ');
    const bearerToken = parts?.length === 2 && parts[0] === 'Bearer' ? parts[1] : null;

    // Accept a valid GitHub OAuth JWT (verifyDashboardJwt returns null if secret not set)
    if (bearerToken) {
      const { verifyDashboardJwt } = await import('../auth/github-oauth.js');
      if (verifyDashboardJwt(bearerToken)) {
        return next();
      }
    }

    // Fall back to static ADMIN_TOKEN (or AUTH_TOKEN if ADMIN_TOKEN not set)
    const adminToken = process.env['ADMIN_TOKEN'];
    const requiredToken = adminToken ?? config.authToken;

    // No token configured → auth disabled (local dev)
    if (!requiredToken) {
      return next();
    }

    if (!bearerToken) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    if (!tokenEquals(bearerToken, requiredToken)) {
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

  // ── GET /v1/admin/me ───────────────────────────────────
  // Returns GitHub user info if authenticated via OAuth, or {authMethod:'token'} for token auth.

  app.get('/v1/admin/me', async (c) => {
    const authHeader = c.req.header('Authorization');
    const parts = authHeader?.split(' ');
    const bearerToken = parts?.length === 2 && parts[0] === 'Bearer' ? parts[1] : null;

    if (bearerToken) {
      const { verifyDashboardJwt } = await import('../auth/github-oauth.js');
      const payload = verifyDashboardJwt(bearerToken);
      if (payload) {
        return c.json({
          authMethod: 'github',
          login: payload.login,
          name: payload.name,
          avatar: payload.avatar,
        });
      }
    }

    return c.json({ authMethod: 'token', login: null, name: 'Admin', avatar: null });
  });

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

  // ── API Key Management Routes (Feature 7) ────────────────

  const CreateKeySchema = z.object({
    userId: z.string().min(1),
    project: z.string().optional(),
    trustLevel: TrustLevelSchema.optional(),
    rateLimitMax: z.number().int().positive().optional(),
    rateLimitWindowMs: z.number().int().positive().optional(),
    budgetUsd: z.number().nonnegative().optional(),
    expiresAt: z.string().optional(),
  });

  /**
   * POST /v1/admin/keys — Create a new API key.
   *
   * Returns the plaintext key ONCE in the response. It is never stored
   * or returned again — only the hash is persisted.
   */
  app.post('/v1/admin/keys', async (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: 'Database not configured', code: 'NOT_CONFIGURED' }, 500);
      }

      const body = await c.req.json();
      const parsed = CreateKeySchema.safeParse(body);

      if (!parsed.success) {
        return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
      }

      const { apiKey, plaintextKey } = createApiKey(deps.db, parsed.data);

      return c.json({
        ok: true,
        key: plaintextKey, // Returned ONCE — never again
        id: apiKey.id,
        keyPrefix: apiKey.keyPrefix,
        userId: apiKey.userId,
        project: apiKey.project,
        trustLevel: apiKey.trustLevel,
        rateLimitMax: apiKey.rateLimitMax,
        rateLimitWindowMs: apiKey.rateLimitWindowMs,
        budgetUsd: apiKey.budgetUsd,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
      }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * GET /v1/admin/keys — List all API keys (masked, no hashes).
   *
   * Optionally filter by userId query parameter.
   */
  app.get('/v1/admin/keys', (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: 'Database not configured', code: 'NOT_CONFIGURED' }, 500);
      }

      const userId = c.req.query('userId');
      const keys = listApiKeys(deps.db, userId ?? undefined);

      // Never expose keyHash in the response
      const masked = keys.map((k) => ({
        id: k.id,
        keyPrefix: k.keyPrefix,
        userId: k.userId,
        project: k.project,
        trustLevel: k.trustLevel,
        rateLimitMax: k.rateLimitMax,
        rateLimitWindowMs: k.rateLimitWindowMs,
        budgetUsd: k.budgetUsd,
        enabled: k.enabled,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
      }));

      return c.json({ keys: masked });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * DELETE /v1/admin/keys/:id — Revoke an API key.
   *
   * Does NOT delete the row — sets enabled=0 to keep audit trail.
   */
  app.delete('/v1/admin/keys/:id', (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: 'Database not configured', code: 'NOT_CONFIGURED' }, 500);
      }

      const id = c.req.param('id');
      const revoked = revokeApiKey(deps.db, id);

      if (!revoked) {
        return c.json({ error: `No API key found with id "${id}"`, code: 'NOT_FOUND' }, 404);
      }

      return c.json({ ok: true, id, message: `API key ${id} revoked` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
}
