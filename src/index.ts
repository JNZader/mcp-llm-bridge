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
import { ApprovalStore } from "./approval/index.js";
import { BridgeOrchestrator, loadBridgeConfig } from "./bridge/index.js";
import { CodeSearchService } from "./code-search/index.js";
import { ComparisonStore } from "./comparison/persistence.js";
import { ComparisonService } from "./comparison/service.js";
import { CompressorService } from "./context-compression/index.js";
import { loadConfig } from "./core/config.js";
import { CostTracker } from "./core/cost-tracker.js";
import { GroupStore } from "./core/groups.js";
import { logger } from "./core/logger.js";
import { initMetrics } from "./core/metrics.js";
import { Router } from "./core/router.js";
import { SessionStore } from "./core/session.js";
import { registry } from "./core/transformer.js";
import { StateManager } from "./crdt/index.js";
import {
	FreeModelRouter,
	importCatalog,
	loadCatalog,
} from "./free-models/index.js";
import { LatencyMeasurer } from "./latency/index.js";
import { startHttpServer } from "./server/http.js";
import { startMcpServer } from "./server/mcp.js";
import { Vault } from "./vault/index.js";
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

// Register all adapters
for (const adapter of createAllAdapters(vault)) {
	router.register(adapter);
}

// Initialize cost tracker (uses same DB path as vault)
const costTracker = new CostTracker({ dbPath: config.dbPath });
router.setCostTracker(costTracker);

// Wire up transformer registry for the new pipeline
router.setTransformerRegistry(registry);

// Initialize group store (uses same DB path as vault)
const groupStore = new GroupStore(config.dbPath);
router.setGroupStore(groupStore);

// Initialize session store (in-memory with TTL sweep)
const sessionStore = new SessionStore();
router.setSessionStore(sessionStore);

// Initialize context compression service (background pre-computation)
const compressor = new CompressorService();

// Initialize semantic code search service (in-memory index)
const codeSearch = new CodeSearchService();

// Initialize CRDT state manager for multi-agent collaboration
const stateManager = new StateManager();

// Initialize free model router (opt-in via FALLBACK_STRATEGY=free-models)
const freeModelEnabled = process.env["FALLBACK_STRATEGY"] === "free-models";
const freeModelRouter = new FreeModelRouter({ enabled: freeModelEnabled });
if (freeModelEnabled) {
	router.setFreeModelRouter(freeModelRouter);
	logger.info("Free model fallback routing enabled");
}

// Load free model catalog at startup (opt-in via FREE_MODEL_CATALOG=true)
const catalogEnabled = process.env["FREE_MODEL_CATALOG"] === "true";
if (catalogEnabled) {
	const catalog = loadCatalog();
	if (catalog) {
		const entries = importCatalog(catalog, freeModelRouter.getHealthChecker());
		const imported = freeModelRouter.getRegistry().importModels(entries);
		logger.info({ imported }, "Free model catalog loaded at startup");
	}
}

// Initialize latency-based routing (opt-in via LATENCY_ROUTING=true)
const latencyRoutingEnabled = process.env["LATENCY_ROUTING"] === "true";
const latencyMeasurer = new LatencyMeasurer();
if (latencyRoutingEnabled) {
	router.setLatencyMeasurer(latencyMeasurer);
	logger.info("Latency-based routing enabled");
}

// Initialize bridge orchestrator (opt-in via bridge.yaml config)
const bridgeConfig = loadBridgeConfig();
const bridge = bridgeConfig
	? new BridgeOrchestrator(router, bridgeConfig)
	: null;
if (bridge) {
	logger.info("Bridge orchestrator enabled — task-aware routing active");
}

// ── Approval Store ──────────────────────────────────────
const approvalStore = new ApprovalStore();
router.setApprovalStore(approvalStore);

// ── Local LLM Provider ────────────────────────────────────
const localLLMEnabled = process.env["LOCAL_LLM_ENABLED"] === "true";
let localLLMProvider: LocalLLMProvider | null = null;

if (localLLMEnabled) {
	localLLMProvider = new LocalLLMProvider({
		enabled: true,
		ollamaUrl: process.env["OLLAMA_URL"] ?? "http://localhost:11434",
		lmStudioUrl: process.env["LM_STUDIO_URL"] ?? "http://localhost:1234",
	});

	// Register as normal provider so it participates in routing + circuit breakers
	router.register(localLLMProvider);
	// Also set as local LLM client for other consumers
	router.setLocalLLMClient(localLLMProvider);

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
const autoDiscoverEnabled = process.env["AUTO_DISCOVER_MODELS"] === "true";
	if (autoDiscoverEnabled && localLLMEnabled) {
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
		sessionStore.destroy();
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
const comparisonStore = new ComparisonStore(db);
const comparisonService = new ComparisonService(router, {
	freeModelRegistry: freeModelEnabled
		? freeModelRouter.getRegistry()
		: undefined,
	store: comparisonStore,
	maxCostCeiling: maxComparisonCostUsd,
});

if (mode === "serve") {
	// HTTP only
	startHttpServer(
		router,
		vault,
		config,
		groupStore,
		costTracker,
		latencyMeasurer,
		freeModelRouter,
		db,
		comparisonService,
		config.securityProfile,
		approvalStore,
	);
} else {
	// MCP stdio (default — backward compatible)
	await startMcpServer(
		router,
		vault,
		undefined,
		costTracker,
		bridge,
		codeSearch,
		stateManager,
		config.securityProfile,
		approvalStore,
	);
	if (mode === "--http") {
		startHttpServer(
			router,
			vault,
			config,
			groupStore,
			costTracker,
			latencyMeasurer,
			freeModelRouter,
			db,
			comparisonService,
			config.securityProfile,
			approvalStore,
		);
	}
}
