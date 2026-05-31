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
import { createAllAdapters, LocalLLMProvider } from "./adapters/index.js";
import { BridgeOrchestrator, loadBridgeConfig } from "./bridge/index.js";
import { ComparisonService } from "./comparison/service.js";
import {
	createComparisonServices,
	createCoreServices,
	createToolingServices,
} from "./bootstrap/core-services.js";
import { loadConfig } from "./core/config.js";
import { logger } from "./core/logger.js";
import { initMetrics } from "./core/metrics.js";
import {
	autoDiscoverModelsEnabled,
	freeModelCatalogEnabled,
	latencyRoutingEnabled,
	localLLMEnabled,
	modelRoutingEnabled,
} from "./core/runtime-flags.js";
import { Router } from "./core/router.js";
import { SessionManager } from "./session/index.js";
import { registry } from "./core/transformer.js";
import { StateManager } from "./crdt/index.js";
import {
	FreeModelRouter,
	importCatalog,
	loadCatalog,
} from "./free-models/index.js";
import { LatencyMeasurer } from "./latency/index.js";
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
import { discoverModels } from "./model-discovery/index.js";

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

// Initialize free model router (opt-in via FALLBACK_STRATEGY=free-models)
const freeModelEnabled = process.env["FALLBACK_STRATEGY"] === "free-models";
const freeModelRouter = new FreeModelRouter({ enabled: freeModelEnabled });
if (freeModelEnabled) {
	router.setFreeModelRouter(freeModelRouter);
	logger.info("Free model fallback routing enabled");
}

// Load free model catalog at startup (opt-in via FREE_MODEL_CATALOG=true)
const catalogEnabled = freeModelCatalogEnabled();
if (catalogEnabled) {
	const catalog = loadCatalog();
	if (catalog) {
		const entries = importCatalog(catalog, freeModelRouter.getHealthChecker());
		const imported = freeModelRouter.getRegistry().importModels(entries);
		logger.info({ imported }, "Free model catalog loaded at startup");
	}
}

// Initialize latency-based routing (opt-in via LATENCY_ROUTING=true)
const latencyRouting = latencyRoutingEnabled();
const latencyMeasurer = new LatencyMeasurer();
if (latencyRouting) {
	router.setLatencyMeasurer(latencyMeasurer);
	logger.info("Latency-based routing enabled");
}

// ── Model Routing ───────────────────────────────────────
const modelRouting = modelRoutingEnabled();
if (modelRouting) {
	const { bootstrapModelRouter } = await import("./model-routing/index.js");
	const modelRouter = bootstrapModelRouter(router.providers);
	if (modelRouter) {
		router.setModelRouter(modelRouter);
		logger.info("Model routing enabled");
	} else {
		logger.warn("Model routing config missing or disabled");
	}
}

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

// ── Local LLM Provider ────────────────────────────────────
const localLLMRuntimeEnabled = localLLMEnabled();
let localLLMProvider: LocalLLMProvider | null = null;

if (localLLMRuntimeEnabled) {
	localLLMProvider = new LocalLLMProvider({
		enabled: true,
		ollamaUrl: process.env["OLLAMA_URL"] ?? "http://localhost:11434",
		lmStudioUrl: process.env["LM_STUDIO_URL"] ?? "http://localhost:1234",
	});

	// Register as normal provider so it participates in routing + circuit breakers
	router.register(localLLMProvider);

	// Detect models at bootstrap
	await localLLMProvider.refreshModels();
	if (localLLMProvider.models.length > 0) {
		logger.info(
			{ models: localLLMProvider.models.map((m) => m.id) },
			"Local LLM provider active",
		);
	} else {
		logger.warn("Local LLM enabled but no backends detected — will use cloud providers only");
	}
}

// ── HF Auto-Discovery ───────────────────────────────────
const autoDiscoverEnabled = autoDiscoverModelsEnabled();
if (autoDiscoverEnabled && localLLMRuntimeEnabled) {
	try {
		const discoveryResult = await discoverModels(
			{
				hfToken: process.env["HF_TOKEN"],
				enabled: true,
			},
			{
				ollamaUrl: process.env["OLLAMA_URL"] ?? "http://localhost:11434",
				lmStudioUrl: process.env["LM_STUDIO_URL"] ?? "http://localhost:1234",
			},
			db,
		);
		logger.info(
			{
				models: discoveryResult.models.length,
				enriched: discoveryResult.enrichedCount,
				backends: discoveryResult.backendsScanned,
			},
			"Model discovery completed at bootstrap",
		);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		logger.warn({ error: msg }, "Model discovery failed at bootstrap");
	}
}

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
