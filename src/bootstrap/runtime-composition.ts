import type { BridgeConfig, BridgeOrchestrator } from "../bridge/index.js";
import type { ComparisonService } from "../comparison/service.js";
import type { Router } from "../core/router.js";
import type { GatewayConfig } from "../core/types.js";
import type { FreeModelRouter } from "../free-models/router.js";
import type { LatencyMeasurer } from "../latency/index.js";
import type {
	PluginRuntimeRegistry,
	createPluginRuntimeRegistry,
} from "../mcp-builder/plugin-runtime-registry.js";
import type { Vault } from "../vault/index.js";
import type Database from "better-sqlite3";
import type {
	ComparisonServices,
	CoreServices,
	ToolingServices,
} from "./core-services.js";
import type { bootstrapLocalLLM } from "./local-llm.js";
import type {
	RouterFeaturesBootstrapResult,
	bootstrapRouterFeatures,
} from "./router-features.js";
import type { createRuntimeFoundation } from "./runtime-foundation.js";
import type { createSupportServices } from "./support-services.js";

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
	pluginRuntimeRegistry: PluginRuntimeRegistry;
}

export interface RuntimeCompositionDependencies {
	readonly createRuntimeFoundation: typeof createRuntimeFoundation;
	readonly bootstrapRouterFeatures: typeof bootstrapRouterFeatures;
	readonly bootstrapLocalLLM: typeof bootstrapLocalLLM;
	readonly createSupportServices: typeof createSupportServices;
	readonly createPluginRuntimeRegistry: typeof createPluginRuntimeRegistry;
}

/** Composes the runtime graph while leaving side-effecting leaves injectable. */
export async function composeRuntimeContext(
	dependencies: RuntimeCompositionDependencies,
): Promise<RuntimeContext> {
	const { config, vault, router, db, coreServices } =
		await dependencies.createRuntimeFoundation();

	const {
		freeModelEnabled,
		freeModelRouter,
		latencyMeasurer,
		bridgeConfig,
		bridge,
	}: RouterFeaturesBootstrapResult = await dependencies.bootstrapRouterFeatures(
		router,
		vault,
		coreServices,
	);

	await dependencies.bootstrapLocalLLM(router, db);
	router.freezeProviderRegistry();

	const supportServices = dependencies.createSupportServices({
		db,
		dbPath: config.dbPath,
		router,
		freeModelEnabled,
		freeModelRouter,
	});

	return {
		pluginRuntimeRegistry: dependencies.createPluginRuntimeRegistry(),
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
