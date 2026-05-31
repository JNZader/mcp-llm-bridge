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
import type { SessionManager } from '../session/index.js';
import { parseBearerToken, tokenEquals } from './auth-helpers/bearer.js';
import { registerAdminApiKeyRoutes } from './routes/admin/api-keys.js';
import { registerAdminDiscoveryRoutes } from './routes/admin/discovery.js';
import { registerAdminDashboardRoutes } from './routes/admin/dashboard.js';
import { registerAdminOperationsRoutes } from './routes/admin/operations.js';
import { registerAdminShellRoutes } from './routes/admin/shell.js';
import { registerAdminSecurityProfileRoutes } from './routes/admin/security-profiles.js';
import { registerAdminSyncRoutes } from './routes/admin/sync.js';

// ── Admin Auth Middleware ─────────────────────────────────

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

    const bearerToken = parseBearerToken(c.req.header('Authorization'));

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
  const { config } = deps;
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
  registerAdminOperationsRoutes(app, { costTracker: deps.costTracker });
  registerAdminShellRoutes(app, { config });
  registerAdminSecurityProfileRoutes(app, { db: deps.db });
  registerAdminSyncRoutes(app, { db: deps.db, vault: deps.vault });
}
