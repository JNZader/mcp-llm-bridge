import type { BridgeOrchestrator, BridgeConfig } from "../bridge/index.js";
import type { Router } from "../core/router.js";
import type { FreeModelRouter } from "../free-models/router.js";
import type { LatencyMeasurer } from "../latency/index.js";
import { Vault } from "../vault/index.js";
import type { CoreServices } from "./core-services.js";
import { bootstrapBridge } from "./bridge.js";
import { bootstrapFreeModels } from "./free-models.js";
import { bootstrapLatencyRouting } from "./latency.js";
import { bootstrapModelRouting } from "./model-routing.js";
import { bootstrapRouterBaseline } from "./router-baseline.js";

export interface RouterFeaturesBootstrapResult {
	freeModelEnabled: boolean;
	freeModelRouter: FreeModelRouter;
	latencyMeasurer: LatencyMeasurer;
	bridgeConfig: BridgeConfig | null;
	bridge: BridgeOrchestrator | null;
}

export async function bootstrapRouterFeatures(
	router: Router,
	vault: Vault,
	coreServices: CoreServices,
): Promise<RouterFeaturesBootstrapResult> {
	bootstrapRouterBaseline(router, vault, coreServices);

	const { freeModelEnabled, freeModelRouter } = bootstrapFreeModels(router);
	const latencyMeasurer = bootstrapLatencyRouting(router);

	await bootstrapModelRouting(router);

	const { bridgeConfig, bridge } = bootstrapBridge(router);

	return {
		freeModelEnabled,
		freeModelRouter,
		latencyMeasurer,
		bridgeConfig,
		bridge,
	};
}
