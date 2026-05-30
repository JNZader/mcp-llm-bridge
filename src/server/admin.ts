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
import type { SessionManager } from '../session/session-manager.js';
import { registerAdminApiKeyRoutes } from './routes/admin/api-keys.js';
import { registerAdminDiscoveryRoutes } from './routes/admin/discovery.js';
import { registerAdminDashboardRoutes } from './routes/admin/dashboard.js';
import { registerAdminSecurityProfileRoutes } from './routes/admin/security-profiles.js';
import { registerAdminSyncRoutes } from './routes/admin/sync.js';

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
  /** Optional session manager for group-level sticky session metrics. */
  sessionManager?: SessionManager;
}

/**
 * Register all /v1/admin/* routes on the Hono app.
 */
export function registerAdminRoutes(app: Hono, deps: AdminDeps): void {
  const { config, costTracker } = deps;
  // Admin auth middleware for all /v1/admin/* routes
  app.use('/v1/admin/*', adminAuth(config));

  registerAdminApiKeyRoutes(app, { db: deps.db });
  registerAdminDashboardRoutes(app, {
    router: deps.router,
    groupStore: deps.groupStore,
    costTracker: deps.costTracker,
    serverStartTime: deps.serverStartTime,
    sessionManager: deps.sessionManager,
  });
  registerAdminDiscoveryRoutes(app, {
    db: deps.db,
    freeModelRouter: deps.freeModelRouter,
  });
  registerAdminSecurityProfileRoutes(app, { db: deps.db });
  registerAdminSyncRoutes(app, { db: deps.db, vault: deps.vault });

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

  // ── GET /v1/admin/security-profile ─────────────────────

  app.get('/v1/admin/security-profile', (c) => {
    return c.json({
      profile: config.securityProfile ?? 'local-dev',
      allowedCategories: ['destructive', 'read', 'generate', 'admin'],
      rateLimit: null,
    });
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

}
