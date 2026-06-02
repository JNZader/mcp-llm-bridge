import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Context, Next } from "hono";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";

import { SQLiteAnalyticsReader, type AnalyticsAggregator } from "../analytics/index.js";
import type { ApprovalStore } from "../approval/index.js";
import { apiKeyAuth } from "../auth/middleware.js";
import type { ComparisonService } from "../comparison/service.js";
import { MAX_BODY_SIZE } from "../core/constants.js";
import type { CostTracker } from "../core/cost-tracker.js";
import type { GroupStore } from "../core/groups.js";
import {
	getCorsOrigins,
	getTrustedProxyIps,
	isMultiTenantEnabled,
} from "../core/http-runtime-config.js";
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
import { hasStaticBearerToken, parseBearerToken } from "./auth-helpers/bearer.js";
import { RateLimiter } from "./rate-limit.js";
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerCircuitBreakerRoutes } from "./routes/circuit-breaker.js";
import { registerComparisonRoutes } from "./routes/comparison.js";
import { registerExecutionRoutes } from "./routes/execution.js";
import { registerGroupRoutes } from "./routes/groups.js";
import { registerMetadataRoutes } from "./routes/metadata.js";
import { registerObservabilityRoutes } from "./routes/observability.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerStorageRoutes } from "./routes/storage.js";
import { registerToolingRoutes } from "./routes/tooling.js";
import { registerUsageRoutes } from "./routes/usage.js";

/** Request timeout in milliseconds (2 minutes). */
const REQUEST_TIMEOUT_MS = 120_000;

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
}

/**
 * Bearer token auth middleware.
 *
 * - If `config.authToken` is not set -> all requests pass (auth disabled).
 * - Skips `GET /health` (Coolify health checks) and `OPTIONS *` (CORS preflight).
 * - All other routes including the dashboard require `Authorization: Bearer <token>`.
 */
function bearerAuth(config: GatewayConfig) {
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
		if (!authHeader) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		if (!parseBearerToken(authHeader)) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		if (!hasStaticBearerToken(authHeader, config.authToken)) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		return next();
	};
}

async function bodySizeLimit(c: Context, next: Next): Promise<Response | void> {
	const contentLength = c.req.header("content-length");
	if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
		return c.json(
			{ error: "Payload too large", code: "PAYLOAD_TOO_LARGE" },
			413,
		);
	}
	await next();
}

function getClientIp(c: Context): string {
	const trustedProxies = getTrustedProxyIps();

	if (!trustedProxies) {
		return c.req.header("x-real-ip") ?? "unknown";
	}

	const directIp = c.req.header("x-real-ip") ?? "unknown";

	if (trustedProxies.has(directIp)) {
		const forwarded = c.req.header("x-forwarded-for");
		if (forwarded) {
			const firstIp = forwarded.split(",")[0];
			return firstIp?.trim() ?? directIp;
		}
	}

	return directIp;
}

async function requestTimeout(
	c: Context,
	next: Next,
): Promise<Response | void> {
	let timedOut = false;

	const timeoutId = setTimeout(() => {
		timedOut = true;
	}, REQUEST_TIMEOUT_MS);

	try {
		await next();
	} finally {
		clearTimeout(timeoutId);
	}

	if (timedOut) {
		return c.json({ error: "Request timeout", code: "REQUEST_TIMEOUT" }, 408);
	}
}

async function correlationId(c: Context, next: Next): Promise<void> {
	const existingId = c.req.header(CORRELATION_ID_HEADER);
	const correlationId = existingId ?? randomUUID();

	c.set("correlationId", correlationId);
	c.header(CORRELATION_ID_HEADER, correlationId);

	await next();
}

function rateLimitMiddleware(limiter: RateLimiter) {
	return async (c: Context, next: Next): Promise<void> => {
		if (c.req.method === "GET" && c.req.path === "/health") {
			return next();
		}

		const ip = getClientIp(c);

		if (limiter.isRateLimited(ip)) {
			const resetAt = limiter.getResetAt(ip);
			const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
			c.header("Retry-After", String(retryAfter));
			c.header("X-RateLimit-Remaining", "0");
			c.header("X-RateLimit-Reset", String(Math.floor(resetAt / 1000)));
			c.status(429);
			c.json({
				error: "Too many requests",
				code: "RATE_LIMITED",
				retryAfter,
			});
			return;
		}

		c.header("X-RateLimit-Remaining", String(limiter.getRemaining(ip)));
		c.header(
			"X-RateLimit-Reset",
			String(Math.floor(limiter.getResetAt(ip) / 1000)),
		);

		await next();
	};
}

function normalizeMetricsPath(path: string): string {
	const patterns: Array<[RegExp, string]> = [
		[/^\/v1\/credentials\/[^/]+$/, '/v1/credentials/:id'],
		[/^\/v1\/files\/[^/]+$/, '/v1/files/:id'],
		[/^\/v1\/admin\/profiles\/[^/]+$/, '/v1/admin/profiles/:project'],
		[/^\/v1\/admin\/keys\/[^/]+$/, '/v1/admin/keys/:id'],
		[/^\/v1\/admin\/reset-circuit-breaker\/[^/]+$/, '/v1/admin/reset-circuit-breaker/:provider'],
		[/^\/v1\/groups\/[^/]+$/, '/v1/groups/:id'],
	];

	for (const [pattern, replacement] of patterns) {
		if (pattern.test(path)) {
			return replacement;
		}
	}

	return path;
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
	registerToolingRoutes(app);
	registerStorageRoutes(app, { vault });
	registerExecutionRoutes(app, {
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

	app.use(compress());
	app.use("*", httpMetrics);
	app.use(requestTimeout);
	app.use(correlationId);
	app.use("*", rateLimitMiddleware(rateLimiter));
	app.use("*", bodySizeLimit);

	const corsOrigins = getCorsOrigins();
	app.use(
		"*",
		cors({
			origin: corsOrigins === "*" ? "*" : corsOrigins,
			allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization", "X-Project"],
			exposeHeaders: ["Content-Length"],
			maxAge: 86400,
		}),
	);

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
