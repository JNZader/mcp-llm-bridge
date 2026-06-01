import type Database from "better-sqlite3";

import type { BridgeOrchestrator, BridgeConfig } from "../bridge/index.js";
import { ComparisonService } from "../comparison/service.js";
import {
	type ComparisonServices,
	type CoreServices,
	type ToolingServices,
} from "./core-services.js";
import { bootstrapLocalLLM } from "./local-llm.js";
import { type GatewayConfig } from "../core/types.js";
import type { FreeModelRouter } from "../free-models/router.js";
import type { LatencyMeasurer } from "../latency/index.js";
import { Vault } from "../vault/index.js";
import { bootstrapRouterFeatures } from "./router-features.js";
import { createRuntimeFoundation } from "./runtime-foundation.js";
import { createSupportServices } from "./support-services.js";

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
	const { config, vault, router, db, coreServices } =
		await createRuntimeFoundation();

	const {
		freeModelEnabled,
		freeModelRouter,
		latencyMeasurer,
		bridgeConfig,
		bridge,
	} = await bootstrapRouterFeatures(router, vault, coreServices);

	await bootstrapLocalLLM(router, db);

	const supportServices = createSupportServices({
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
		...supportServices,
	};
}
