#!/usr/bin/env node

/**
 * MCP LLM Bridge — entrypoint.
 *
 * Modes:
 * - Default (no args):     MCP stdio server only (backward compatible)
 * - `--http`:               MCP stdio + HTTP server
 * - `serve`:                HTTP server only (no MCP stdio)
 * - `setup-claude-code`:    Register this bridge as an MCP server in Claude
 *                           Code. Runs BEFORE the runtime is created — does
 *                           NOT create vault.db, master.key, or ~/.llm-gateway.
 */

// Parse mode from argv. Handled first, and `setup-claude-code` is special:
// it must run and exit BEFORE any runtime/config side effects below (no
// vault.db, no master.key, no ~/.llm-gateway directory creation).
const mode = process.argv[2]; // "serve" | "--http" | "setup-claude-code" | undefined

if (mode === "setup-claude-code") {
	const { runSetupClaudeCode } = await import("./setup/claude-code-setup.js");
	const exitCode = await runSetupClaudeCode(process.argv.slice(3), import.meta.url);
	process.exit(exitCode);
}

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
