import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Context, Next } from "hono";
import { Hono } from "hono";
import { compress } from "hono/compress";

import { SQLiteAnalyticsReader, type AnalyticsAggregator } from "../analytics/index.js";
import type { ApprovalStore } from "../approval/index.js";
import { apiKeyAuth } from "../auth/middleware.js";
import type { ComparisonService } from "../comparison/service.js";
import { GENERATE_HTTP_TIMEOUT_MS, MAX_BODY_SIZE } from "../core/constants.js";
import type { CostTracker } from "../core/cost-tracker.js";
import type { GroupStore } from "../core/groups.js";
import {
	getCorsOrigins,
	getTrustedProxyIps,
	isMultiTenantEnabled,
} from "../core/http-runtime-config.js";
import { logger } from "../core/logger.js";
import { startHttpTimer } from "../core/metrics.js";
import type { Router } from "../core/router.js";
import type { GatewayConfig, TrustLevel } from "../core/types.js";
import type { FreeModelRouter } from "../free-models/router.js";
import type { LatencyMeasurer } from "../latency/index.js";
import type { RequestLogger } from "../logging/request-logger.js";
import { securityProfileMiddleware } from "../security/enforcer.js";
import type { SessionManager } from "../session/index.js";
import type { Vault } from "../vault/vault.js";
import { registerAdminRoutes } from "./admin.js";
import type { AdminDiscoveryServices } from "./routes/admin/discovery.js";
import { hasStaticBearerToken, parseBearerToken, tokenEquals } from "./auth-helpers/bearer.js";
import { RateLimiter } from "./rate-limit.js";
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerCircuitBreakerRoutes } from "./routes/circuit-breaker.js";
import { registerComparisonRoutes } from "./routes/comparison.js";
import { registerExecutionRoutes } from "./routes/execution.js";
import { registerGroupRoutes } from "./routes/groups.js";
import { registerMessagesRoutes } from "./routes/messages.js";
import { registerMetadataRoutes } from "./routes/metadata.js";
import { registerObservabilityRoutes } from "./routes/observability.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerStorageRoutes } from "./routes/storage.js";
import { registerToolingRoutes, type ToolingRouteDeps } from "./routes/tooling.js";
import { registerUsageRoutes } from "./routes/usage.js";
import { normalizeMetricsPath } from "./http-helpers/metrics-path.js";
import { createClientIpResolver, type ClientIpResolver } from "./http-helpers/client-ip.js";
import { createCorsPolicy } from "./http-helpers/cors-policy.js";

/** Header name for request correlation ID. */
export const CORRELATION_ID_HEADER = "X-Correlation-ID";

export interface CreateHttpAppDeps {
	router: Router;
	vault: Vault;
	config: GatewayConfig;
	serverStartTime: number;
	groupStore?: GroupStore;
	costTracker?: CostTracker;
	latencyMeasurer?: LatencyMeasurer;
	freeModelRouter?: FreeModelRouter;
	db?: Database.Database;
	analyticsAggregator?: AnalyticsAggregator;
	comparisonService?: ComparisonService;
	securityProfile?: TrustLevel;
	approvalStore?: ApprovalStore;
	sessionManager?: SessionManager;
	requestLogger?: RequestLogger;
	toolingRouteDeps?: ToolingRouteDeps;
	adminDiscoveryServices?: AdminDiscoveryServices;
}

/**
 * Bearer token auth middleware.
 *
 * - If `config.authToken` is not set -> all requests pass (auth disabled).
 * - Skips `GET /health` (Coolify health checks) and `OPTIONS *` (CORS preflight).
 * - All other routes including the dashboard require `Authorization: Bearer <token>`,
 *   OR the `x-api-key: <token>` header (Claude Code CLI's default auth header for
 *   Anthropic-shaped clients hitting `/v1/messages`). Both carry the same bridge
 *   token — `x-api-key` is just an alternate header name, not a separate credential.
 */
export function bearerAuth(config: GatewayConfig) {
	return async (c: Context, next: Next) => {
		if (!config.authToken) {
			return next();
		}

		if (c.req.method === "GET" && c.req.path === "/health") {
			return next();
		}

		if (c.req.path.startsWith("/auth/github")) {
			return next();
		}
		if (c.req.path === "/v1/admin/auth-config") {
			return next();
		}

		if (c.req.path.startsWith("/v1/admin/")) {
			return next();
		}

		if (c.req.method === "OPTIONS") {
			return next();
		}

		const authHeader = c.req.header("Authorization");
		if (authHeader) {
			if (!parseBearerToken(authHeader)) {
				return c.json({ error: "Unauthorized" }, 401);
			}

			if (!hasStaticBearerToken(authHeader, config.authToken)) {
				return c.json({ error: "Unauthorized" }, 401);
			}

			return next();
		}

		const apiKeyHeader = c.req.header("x-api-key");
		if (apiKeyHeader) {
			if (!tokenEquals(apiKeyHeader, config.authToken)) {
				return c.json({ error: "Unauthorized" }, 401);
			}

			return next();
		}

		return c.json({ error: "Unauthorized" }, 401);
	};
}

export async function bodySizeLimit(c: Context, next: Next): Promise<Response | void> {
	const contentLength = c.req.header("content-length");
	if (contentLength && !/^\d+$/.test(contentLength)) {
		return c.json({ error: "The request is invalid.", code: "VALIDATION_ERROR" }, 400);
	}
	if (contentLength && Number(contentLength) > MAX_BODY_SIZE) {
		return c.json(
			{ error: "Payload too large", code: "PAYLOAD_TOO_LARGE" },
			413,
		);
	}
	await next();
}

async function requestTimeout(
	_c: Context,
	next: Next,
): Promise<Response | void> {
	let timedOut = false;

	const timeoutId = setTimeout(() => {
		timedOut = true;
	}, GENERATE_HTTP_TIMEOUT_MS);

	try {
		await next();
	} finally {
		clearTimeout(timeoutId);
	}

	if (timedOut) {
		// next() already finished. Replacing a 200 with 408 here double-bills
		// Consorcio after a successful generate (R3-002). Keep the completed body.
		logger.warn(
			{ timeoutMs: GENERATE_HTTP_TIMEOUT_MS },
			"HTTP generate exceeded timeout budget but completed; keeping response",
		);
	}
}

async function correlationId(c: Context, next: Next): Promise<void> {
	const existingId = c.req.header(CORRELATION_ID_HEADER);
	const correlationId = existingId ?? randomUUID();

	c.set("correlationId", correlationId);
	c.header(CORRELATION_ID_HEADER, correlationId);

	await next();
}

export function rateLimitMiddleware(
	limiter: RateLimiter,
	resolveClientIp: ClientIpResolver = createClientIpResolver(getTrustedProxyIps()),
) {
	return async (c: Context, next: Next): Promise<Response | void> => {
		if (c.req.method === "GET" && c.req.path === "/health") {
			return next();
		}

		const ip = resolveClientIp(c);

		if (limiter.isRateLimited(ip)) {
			const resetAt = limiter.getResetAt(ip);
			const retryAfter = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
			c.header("Retry-After", String(retryAfter));
			c.header("X-RateLimit-Remaining", "0");
			c.header("X-RateLimit-Reset", String(Math.max(0, Math.floor(resetAt / 1000))));
			return c.json({
				error: "Too many requests",
				code: "RATE_LIMITED",
				retryAfter,
			}, 429);
		}

		c.header("X-RateLimit-Remaining", String(limiter.getRemaining(ip)));
		c.header(
			"X-RateLimit-Reset",
			String(Math.floor(limiter.getResetAt(ip) / 1000)),
		);

		await next();
	};
}

async function httpMetrics(c: Context, next: Next): Promise<void> {
	const end = startHttpTimer(c.req.method, normalizeMetricsPath(c.req.path));

	try {
		await next();
		end(c.res.status || 200);
	} catch (error) {
		end(500);
		throw error;
	}
}

function registerHttpRoutes(app: Hono, deps: CreateHttpAppDeps): void {
	const {
		router,
		vault,
		config,
		serverStartTime,
		groupStore,
		costTracker,
		latencyMeasurer,
		freeModelRouter,
		db,
		analyticsAggregator,
		comparisonService,
		approvalStore,
		sessionManager,
		requestLogger,
		toolingRouteDeps,
		adminDiscoveryServices,
	} = deps;
	const analyticsReader = db ? new SQLiteAnalyticsReader(db) : undefined;

	registerPublicRoutes(app, {
		router,
		vault,
		config,
		serverStartTime,
	});

	registerObservabilityRoutes(app, {
		router,
		analyticsAggregator,
		analyticsReader,
		requestLogger,
	});
	registerComparisonRoutes(app, { comparisonService });
	registerToolingRoutes(app, toolingRouteDeps);
	registerStorageRoutes(app, { vault });
	registerExecutionRoutes(app, {
		router,
		vault,
		costTracker,
		requestLogger,
	});
	registerMessagesRoutes(app, {
		router,
		vault,
		costTracker,
		requestLogger,
	});
	registerMetadataRoutes(app, {
		router,
		latencyMeasurer,
	});
	registerGroupRoutes(app, { groupStore });
	registerUsageRoutes(app, { costTracker });
	registerCircuitBreakerRoutes(app);
	registerApprovalRoutes(app, { approvalStore });

	registerAdminRoutes(app, {
		router,
		vault,
		config,
		groupStore,
		costTracker,
		serverStartTime,
		freeModelRouter,
		db,
		sessionManager,
		adminDiscoveryServices,
	});
}

export function createHttpApp(deps: CreateHttpAppDeps): Hono {
	const {
		config,
		db,
		costTracker,
		securityProfile,
	} = deps;

	const app = new Hono();
	const rateLimiter = new RateLimiter();
	const resolveClientIp = createClientIpResolver(getTrustedProxyIps());

	app.use(compress());
	app.use("*", httpMetrics);
	app.use(requestTimeout);
	app.use(correlationId);
	app.use("*", createCorsPolicy(getCorsOrigins()));
	app.use("*", rateLimitMiddleware(rateLimiter, resolveClientIp));
	app.use("*", bodySizeLimit);

	const multiTenantDb = isMultiTenantEnabled() ? db : undefined;

	if (multiTenantDb) {
		app.use("/v1/*", async (c: Context, next: Next) => {
			if (c.req.path.startsWith("/v1/admin/")) {
				return next();
			}

			return apiKeyAuth(multiTenantDb, costTracker)(c, next);
		});

		app.use("*", async (c: Context, next: Next) => {
			if (c.req.path.startsWith("/v1/")) {
				return next();
			}

			return bearerAuth(config)(c, next);
		});
	} else {
		app.use("*", bearerAuth(config));
	}

	app.use("/v1/*", securityProfileMiddleware(securityProfile ?? "local-dev"));

	registerHttpRoutes(app, deps);

	return app;
}
