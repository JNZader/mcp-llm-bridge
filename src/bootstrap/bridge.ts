import {
	BridgeOrchestrator,
	loadBridgeConfig,
	type BridgeConfig,
} from "../bridge/index.js";
import { logger } from "../core/logger.js";
import type { Router } from "../core/router.js";

export interface BridgeBootstrapResult {
	bridgeConfig: BridgeConfig | null;
	bridge: BridgeOrchestrator | null;
}

export function bootstrapBridge(
	router: Router,
	configPath?: string,
): BridgeBootstrapResult {
	const bridgeConfig = loadBridgeConfig(configPath);
	router.setBridgeFallbackOrder(bridgeConfig?.fallbackOrder ?? []);
	const bridge = bridgeConfig
		? new BridgeOrchestrator(router, bridgeConfig)
		: null;

	if (bridge) {
		logger.info("Bridge orchestrator enabled — task-aware routing active");
	}

	return {
		bridgeConfig,
		bridge,
	};
}
