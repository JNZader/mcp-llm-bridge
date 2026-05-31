import type Database from "better-sqlite3";

import { createAllAdapters } from "../adapters/index.js";
import {
	BridgeOrchestrator,
	loadBridgeConfig,
	type BridgeConfig,
} from "../bridge/index.js";
import { ComparisonService } from "../comparison/service.js";
import {
	createComparisonServices,
	createCoreServices,
	createToolingServices,
	type ComparisonServices,
	type CoreServices,
	type ToolingServices,
} from "./core-services.js";
import { bootstrapFreeModels } from "./free-models.js";
import { bootstrapLatencyRouting } from "./latency.js";
import { bootstrapLocalLLM } from "./local-llm.js";
import { bootstrapModelRouting } from "./model-routing.js";
import { getMaxComparisonCostUsdFromEnv } from "../core/comparison-config.js";
import { loadConfig } from "../core/config.js";
import { logger } from "../core/logger.js";
import { Router } from "../core/router.js";
import { type GatewayConfig } from "../core/types.js";
import { registry } from "../core/transformer.js";
import { migrate } from "../db/migrate.js";
import type { FreeModelRouter } from "../free-models/router.js";
import type { LatencyMeasurer } from "../latency/index.js";
import { Vault } from "../vault/index.js";

export interface RuntimeContext
	extends CoreServices,
		ToolingServices,
		ComparisonServices {
	config: GatewayConfig;
	vault: Vault;
	router: Router;
	db: Database.Database;
	bridgeConfig: BridgeConfig | null;
	bridge: BridgeOrchestrator | null;
	freeModelEnabled: boolean;
	freeModelRouter: FreeModelRouter;
	latencyMeasurer: LatencyMeasurer;
	comparisonService: ComparisonService;
}

export async function createRuntimeContext(): Promise<RuntimeContext> {
	const config = loadConfig();
	const vault = new Vault(config);
	const router = new Router();

	const db = vault.getDb();

	await migrate({ dbPath: config.dbPath });

	const coreServices = createCoreServices({
		db,
		dbPath: config.dbPath,
	});

	for (const adapter of createAllAdapters(vault)) {
		router.register(adapter);
	}

	router.setCostTracker(coreServices.costTracker);
	router.setAnalyticsAggregator(coreServices.analyticsAggregator);
	router.setTransformerRegistry(registry);
	router.setGroupStore(coreServices.groupStore);

	coreServices.sessionManager.startCleanup();
	router.setSessionManager(coreServices.sessionManager);

	const { freeModelEnabled, freeModelRouter } = bootstrapFreeModels(router);
	const latencyMeasurer = bootstrapLatencyRouting(router);

	await bootstrapModelRouting(router);

	const bridgeConfig = loadBridgeConfig();
	const bridge = bridgeConfig
		? new BridgeOrchestrator(router, bridgeConfig)
		: null;
	if (bridge) {
		logger.info("Bridge orchestrator enabled — task-aware routing active");
	}

	const toolingServices = createToolingServices({
		db,
		dbPath: config.dbPath,
	});

	await bootstrapLocalLLM(router, db);

	const comparisonServices = createComparisonServices({
		db,
		dbPath: config.dbPath,
	});
	const comparisonService = new ComparisonService(router, {
		freeModelRegistry: freeModelEnabled
			? freeModelRouter.getRegistry()
			: undefined,
		store: comparisonServices.comparisonStore,
		maxCostCeiling: getMaxComparisonCostUsdFromEnv(),
	});

	return {
		config,
		vault,
		router,
		db,
		bridgeConfig,
		bridge,
		freeModelEnabled,
		freeModelRouter,
		latencyMeasurer,
		comparisonService,
		...coreServices,
		...toolingServices,
		...comparisonServices,
	};
}
