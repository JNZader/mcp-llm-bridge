import type { Hono } from 'hono';

import {
  getCircuitBreakerAdminStats,
  getProviderCircuitBreakerSummary,
} from '../../../circuit-breaker/admin-compat.js';
import { CircuitState } from '../../../circuit-breaker/index.js';
import { VERSION } from '../../../core/constants.js';
import type { CostTracker } from '../../../core/cost-tracker.js';
import type { GroupStore } from '../../../core/groups.js';
import type { Router } from '../../../core/router.js';
import type { SessionManager } from '../../../session/index.js';
import { SESSION_ENTRY_KIND } from '../../../session/types.js';

export interface AdminDashboardRouteDeps {
  router: Router;
  groupStore?: GroupStore;
  costTracker?: CostTracker;
  serverStartTime: number;
  sessionManager?: SessionManager;
}

export function registerAdminDashboardRoutes(
  app: Hono,
  deps: AdminDashboardRouteDeps,
): void {
  const { router, groupStore, costTracker, serverStartTime, sessionManager } = deps;

  app.get('/v1/admin/overview', async (c) => {
    try {
      const providers = await router.getProviderStatuses();
      const groups = groupStore ? groupStore.list() : [];

      const cbStats = getCircuitBreakerAdminStats();
      const cbSummary = {
        total: cbStats.length,
        open: cbStats.filter((s) => s.state === CircuitState.OPEN).length,
        closed: cbStats.filter((s) => s.state === CircuitState.CLOSED).length,
        halfOpen: cbStats.filter((s) => s.state === CircuitState.HALF_OPEN).length,
      };

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

  app.get('/v1/admin/providers', async (c) => {
    try {
      const providers = await router.getProviderStatuses();
      const detailed = providers.map((p) => {
        const cb = getProviderCircuitBreakerSummary(p.id);
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

  app.get('/v1/admin/sessions', (c) => {
    try {
      if (!sessionManager) {
        return c.json({ error: 'Session systems not available', code: 'NOT_CONFIGURED' }, 503);
      }

      const activeSessions = sessionManager.getActiveSessions();
      const computedAt = Date.now();
      const groupActiveSessions = activeSessions.filter(
        (session) => session.kind === SESSION_ENTRY_KIND.API_GROUP,
      );
      const routerStickySessions = {
        activeSessionCount: activeSessions.filter(
          (session) => session.kind === SESSION_ENTRY_KIND.ROUTER_STICKY,
        ).length,
        computedAt,
      };
      const groupSessions = {
        activeSessionCount: groupActiveSessions.length,
        averageSessionAge: groupActiveSessions.length > 0
          ? Math.floor(
              groupActiveSessions.reduce(
                (total, session) => total + (computedAt - session.createdAt),
                0,
              ) / groupActiveSessions.length,
            )
          : 0,
        byProvider: Array.from(
          groupActiveSessions.reduce(
            (providers, session) => {
              const current = providers.get(session.provider) ?? {
                provider: session.provider,
                sessionCount: 0,
                avgTtlRemaining: 0,
                totalTtlRemaining: 0,
              };
              current.sessionCount += 1;
              current.totalTtlRemaining += session.expiresAt - computedAt;
              providers.set(session.provider, current);
              return providers;
            },
            new Map<string, {
              provider: string;
              sessionCount: number;
              avgTtlRemaining: number;
              totalTtlRemaining: number;
            }>(),
          ).values(),
        ).map((entry) => ({
          provider: entry.provider,
          sessionCount: entry.sessionCount,
          avgTtlRemaining: Math.floor(entry.totalTtlRemaining / entry.sessionCount / 1000),
        })),
        computedAt,
      };

      return c.json({
        note: 'Router sticky routing and group sessions now share one SessionManager instance, but they remain separate session kinds and should not be compared as a single total.',
        routerStickySessions,
        groupSessions,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  app.get('/v1/admin/model-router/stats', (c) => {
    try {
      return c.json(
        router.getModelRouterStats() ?? {
          enabled: false,
          totalDecisions: 0,
          byEndpointTask: [],
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
}
