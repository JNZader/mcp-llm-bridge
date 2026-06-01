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
import { startConfiguredMode } from "./bootstrap/server-startup.js";
import { setupGracefulShutdown } from "./bootstrap/shutdown.js";
import { initMetrics } from "./core/metrics.js";

// Populate the transformer registry with all inbound/outbound transformers
import "./transformers/index.js";

// Initialize metrics
initMetrics();

// Parse mode from argv
const mode = process.argv[2]; // "serve" | "--http" | undefined

const runtime = await createRuntimeContext();

// Setup graceful shutdown
await setupGracefulShutdown({
	compressor: runtime.compressor,
	latencyMeasurer: runtime.latencyMeasurer,
	freeModelRouter: runtime.freeModelRouter,
	costTracker: runtime.costTracker,
	analyticsAggregator: runtime.analyticsAggregator,
	groupStore: runtime.groupStore,
	sessionManager: runtime.sessionManager,
	pageIndexService: runtime.pageIndex.service,
	vault: runtime.vault,
	cleanupAllProviderHomes,
	shutdownTracing,
});

await startConfiguredMode(runtime, mode);
