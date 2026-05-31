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
import { createAllAdapters } from "./adapters/index.js";
import { BridgeOrchestrator, loadBridgeConfig } from "./bridge/index.js";
import { ComparisonService } from "./comparison/service.js";
import {
	createComparisonServices,
	createCoreServices,
	createToolingServices,
} from "./bootstrap/core-services.js";
import { bootstrapFreeModels } from "./bootstrap/free-models.js";
import { bootstrapLatencyRouting } from "./bootstrap/latency.js";
import { bootstrapLocalLLM } from "./bootstrap/local-llm.js";
import { bootstrapModelRouting } from "./bootstrap/model-routing.js";
import { loadConfig } from "./core/config.js";
import { initMetrics } from "./core/metrics.js";
import { Router } from "./core/router.js";
import { registry } from "./core/transformer.js";
import {
	startHttpServerWithDeps,
	type StartHttpServerDeps,
} from "./server/http.js";
import {
	startMcpServer,
	type StartMcpServerDeps,
} from "./server/mcp.js";
import { Vault } from "./vault/index.js";
import { migrate } from "./db/migrate.js";

// Populate the transformer registry with all inbound/outbound transformers
import "./transformers/index.js";

// Initialize metrics
initMetrics();

// Parse mode from argv
const mode = process.argv[2]; // "serve" | "--http" | undefined

// Initialize shared components
const config = loadConfig();
const vault = new Vault(config);
const router = new Router();

// Expose the DB for multi-tenant auth and HF cache (Sprint 3)
const db = vault.getDb();

// Run pending migrations on the vault database
await migrate({ dbPath: config.dbPath });

const {
	requestLogger,
	costTracker,
	analyticsAggregator,
	groupStore,
	sessionManager,
	compressor,
	codeSearch,
	stateManager,
} = createCoreServices({
	db,
	dbPath: config.dbPath,
});

// Register all adapters
for (const adapter of createAllAdapters(vault)) {
	router.register(adapter);
}

router.setCostTracker(costTracker);

router.setAnalyticsAggregator(analyticsAggregator);

// Wire up transformer registry for the new pipeline
router.setTransformerRegistry(registry);

router.setGroupStore(groupStore);

sessionManager.startCleanup();
router.setSessionManager(sessionManager);

const { freeModelEnabled, freeModelRouter } = bootstrapFreeModels(router);

const latencyMeasurer = bootstrapLatencyRouting(router);

// ── Model Routing ───────────────────────────────────────
await bootstrapModelRouting(router);

// Initialize bridge orchestrator (opt-in via bridge.yaml config)
const bridgeConfig = loadBridgeConfig();
const bridge = bridgeConfig
	? new BridgeOrchestrator(router, bridgeConfig)
	: null;
if (bridge) {
	logger.info("Bridge orchestrator enabled — task-aware routing active");
}

const { approvalStore, pageIndexTools } = createToolingServices({
	db,
	dbPath: config.dbPath,
});

// ── Local LLM Provider + HF Auto-Discovery ───────────────
await bootstrapLocalLLM(router, db);

/**
 * Graceful shutdown handler.
 * Closes the vault database connection, provider homes, and tracing on exit.
 */
async function setupGracefulShutdown(vault: Vault): Promise<void> {
	const cleanup = async (signal: string) => {
		logger.info({ signal }, "Shutting down");
		compressor.destroy();
		latencyMeasurer.stopBackgroundTask();
		freeModelRouter.destroy();
		costTracker.destroy();
		groupStore.close();
		sessionManager.destroy();
		cleanupAllProviderHomes();
		vault.destroy();
		await shutdownTracing();
		process.exit(0);
	};

	process.on("SIGINT", () => cleanup("SIGINT"));
	process.on("SIGTERM", () => cleanup("SIGTERM"));
}

// Setup graceful shutdown
await setupGracefulShutdown(vault);

// Initialize comparison service
const maxComparisonCostUsd = parseFloat(
	process.env["MAX_COMPARISON_COST_USD"] ?? "1.0",
);
const { comparisonStore } = createComparisonServices({
	db,
	dbPath: config.dbPath,
});
const comparisonService = new ComparisonService(router, {
	freeModelRegistry: freeModelEnabled
		? freeModelRouter.getRegistry()
		: undefined,
	store: comparisonStore,
	maxCostCeiling: maxComparisonCostUsd,
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
