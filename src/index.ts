#!/usr/bin/env node

/**
 * MCP LLM Bridge — entrypoint.
 *
 * Modes:
 * - Default (no args):  MCP stdio server only (backward compatible)
 * - `--http`:           MCP stdio + HTTP server
 * - `serve`:            HTTP server only (no MCP stdio)
 */

// Initialize tracing before other imports
import { initTracing, shutdownTracing } from "./core/tracing.js";

initTracing();

import { cleanupAllProviderHomes } from "./adapters/cli-home.js";
import { createRuntimeContext } from "./bootstrap/runtime-context.js";
import { setupGracefulShutdown } from "./bootstrap/shutdown.js";
import { initMetrics } from "./core/metrics.js";
import {
	startHttpServerWithDeps,
	type StartHttpServerDeps,
} from "./server/http.js";
import {
	startMcpServer,
	type StartMcpServerDeps,
} from "./server/mcp.js";

// Populate the transformer registry with all inbound/outbound transformers
import "./transformers/index.js";

// Initialize metrics
initMetrics();

// Parse mode from argv
const mode = process.argv[2]; // "serve" | "--http" | undefined

const {
	config,
	vault,
	router,
	db,
	requestLogger,
	costTracker,
	analyticsAggregator,
	groupStore,
	sessionManager,
	compressor,
	codeSearch,
	stateManager,
	freeModelRouter,
	latencyMeasurer,
	bridge,
	approvalStore,
	pageIndexTools,
	comparisonService,
} = await createRuntimeContext();

// Setup graceful shutdown
await setupGracefulShutdown({
	compressor,
	latencyMeasurer,
	freeModelRouter,
	costTracker,
	groupStore,
	sessionManager,
	vault,
	cleanupAllProviderHomes,
	shutdownTracing,
});

function buildHttpServerDeps(): StartHttpServerDeps {
	return {
		router,
		vault,
		config,
		groupStore,
		costTracker,
		latencyMeasurer,
		freeModelRouter,
		db,
		analyticsAggregator,
		comparisonService,
		securityProfile: config.securityProfile,
		approvalStore,
		sessionManager,
		requestLogger,
	};
}

function buildMcpServerDeps(): StartMcpServerDeps {
	return {
		router,
		vault,
		costTracker,
		bridge,
		codeSearch,
		stateManager,
		securityProfile: config.securityProfile,
		approvalStore,
		pageIndexTools,
	};
}

function startServeMode(): void {
	startHttpServerWithDeps(buildHttpServerDeps());
}

function startHttpOnlyMode(): void {
	startHttpServerWithDeps(buildHttpServerDeps());
}

async function startDefaultMcpMode(): Promise<void> {
	await startMcpServer(buildMcpServerDeps());
}

if (mode === "serve") {
	// HTTP only
	startServeMode();
} else {
	// MCP stdio (default — backward compatible)
	await startDefaultMcpMode();
	if (mode === "--http") {
		startHttpOnlyMode();
	}
}
