import type Database from "better-sqlite3";

import type { BridgeOrchestrator, BridgeConfig } from "../bridge/index.js";
import { ComparisonService } from "../comparison/service.js";
import {
	createCoreServices,
	createToolingServices,
	type ComparisonServices,
	type CoreServices,
	type ToolingServices,
} from "./core-services.js";
import { createComparisonContext } from "./comparison.js";
import { bootstrapFreeModels } from "./free-models.js";
import { bootstrapLatencyRouting } from "./latency.js";
import { bootstrapLocalLLM } from "./local-llm.js";
import { bootstrapModelRouting } from "./model-routing.js";
import { bootstrapBridge } from "./bridge.js";
import { loadConfig } from "../core/config.js";
import { Router } from "../core/router.js";
import { type GatewayConfig } from "../core/types.js";
import { migrate } from "../db/migrate.js";
import type { FreeModelRouter } from "../free-models/router.js";
import type { LatencyMeasurer } from "../latency/index.js";
import { Vault } from "../vault/index.js";
import { bootstrapRouterBaseline } from "./router-baseline.js";

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

	bootstrapRouterBaseline(router, vault, coreServices);

	const { freeModelEnabled, freeModelRouter } = bootstrapFreeModels(router);
	const latencyMeasurer = bootstrapLatencyRouting(router);

	await bootstrapModelRouting(router);

	const { bridgeConfig, bridge } = bootstrapBridge(router);

	const toolingServices = createToolingServices({
		db,
		dbPath: config.dbPath,
	});

	await bootstrapLocalLLM(router, db);

	const comparisonContext = createComparisonContext({
		db,
		dbPath: config.dbPath,
		router,
		freeModelEnabled,
		freeModelRouter,
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
		...coreServices,
		...toolingServices,
		...comparisonContext,
	};
}
