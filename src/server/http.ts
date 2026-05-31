/**
 * HTTP Server — Hono-based REST API for the LLM Gateway.
 *
 * Provides HTTP endpoints for LLM generation, model listing,
 * provider status, and credential management.
 *
 * Supports per-project scoping via `project` body field or `X-Project` header.
 */

import { type ServerType, serve } from "@hono/node-server";

import type Database from "better-sqlite3";
import type { AnalyticsAggregator } from "../analytics/index.js";
import type { ApprovalStore } from "../approval/index.js";
import type { ComparisonService } from "../comparison/service.js";
import type { CostTracker } from "../core/cost-tracker.js";
import type { GroupStore } from "../core/groups.js";
import { logger } from "../core/logger.js";
import type { Router } from "../core/router.js";
import type { GatewayConfig, TrustLevel } from "../core/types.js";
import type { FreeModelRouter } from "../free-models/router.js";
import type { LatencyMeasurer } from "../latency/index.js";
import type { RequestLogger } from "../logging/request-logger.js";
import type { SessionManager } from "../session/index.js";
import type { Vault } from "../vault/vault.js";
import type { CreateHttpAppDeps } from "./http-app.js";
import { createHttpApp } from "./http-app.js";

export { CORRELATION_ID_HEADER } from "./http-app.js";

export type StartHttpServerDeps = Omit<CreateHttpAppDeps, "serverStartTime">;

function isStartHttpServerDeps(
	input: Router | StartHttpServerDeps,
): input is StartHttpServerDeps {
	return (
		typeof input === "object" &&
		input !== null &&
		"router" in input &&
		"vault" in input &&
		"config" in input
	);
}

/** Server start time for uptime calculation. */
let serverStartTime: number = Date.now();

/**
 * Start the HTTP server on the configured port.
 *
 * All endpoints share the same Router and Vault instances
 * as the MCP server.
 *
 * @returns The HTTP server instance
 */
export function startHttpServerWithDeps(deps: StartHttpServerDeps): ServerType {
	const { config } = deps;

	// Reset start time on server creation
	serverStartTime = Date.now();

	const app = createHttpApp({
		...deps,
		serverStartTime,
	});

	// ── Start ──────────────────────────────────────────────

	const server = serve(
		{
			fetch: app.fetch,
			port: config.httpPort,
		},
		(info) => {
			logger.info({ port: info.port }, "HTTP server started");
		},
	);

	return server;
}

export function startHttpServer(deps: StartHttpServerDeps): ServerType;
/**
 * @deprecated Use `startHttpServer({ ...deps })` object-style startup instead.
 * This positional overload is kept only as a temporary compatibility bridge
 * for stale build artifacts and possible external callers.
 */
export function startHttpServer(
	router: Router,
	vault: Vault,
	config: GatewayConfig,
	groupStore?: GroupStore,
	costTracker?: CostTracker,
	latencyMeasurer?: LatencyMeasurer,
	freeModelRouter?: FreeModelRouter,
	db?: Database.Database,
	analyticsAggregator?: AnalyticsAggregator,
	comparisonService?: ComparisonService,
	securityProfile?: TrustLevel,
	approvalStore?: ApprovalStore,
	sessionManager?: SessionManager,
	requestLogger?: RequestLogger,
	..._rest: unknown[]
): ServerType;
export function startHttpServer(
	routerOrDeps: Router | StartHttpServerDeps,
	vault?: Vault,
	config?: GatewayConfig,
	groupStore?: GroupStore,
	costTracker?: CostTracker,
	latencyMeasurer?: LatencyMeasurer,
	freeModelRouter?: FreeModelRouter,
	db?: Database.Database,
	analyticsAggregator?: AnalyticsAggregator,
	comparisonService?: ComparisonService,
	securityProfile?: TrustLevel,
	approvalStore?: ApprovalStore,
	sessionManager?: SessionManager,
	requestLogger?: RequestLogger,
	..._rest: unknown[]
): ServerType {
	if (isStartHttpServerDeps(routerOrDeps)) {
		return startHttpServerWithDeps(routerOrDeps);
	}

	if (!vault || !config) {
		throw new Error("startHttpServer requires vault and config");
	}

	return startHttpServerWithDeps({
		router: routerOrDeps,
		vault,
		config,
		groupStore,
		costTracker,
		latencyMeasurer,
		freeModelRouter,
		db,
		analyticsAggregator,
		comparisonService,
		securityProfile,
		approvalStore,
		sessionManager,
		requestLogger,
	});
}
