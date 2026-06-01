import { createAllAdapters } from "../adapters/index.js";
import type { AnalyticsAggregator } from "../analytics/aggregator.js";
import type { CostTracker } from "../core/cost-tracker.js";
import type { GroupStore } from "../core/groups.js";
import { Router } from "../core/router.js";
import { registry } from "../core/transformer.js";
import type { SessionManager } from "../session/session-manager.js";
import { Vault } from "../vault/index.js";

type BaselineRouterServices = {
	costTracker: CostTracker;
	analyticsAggregator: AnalyticsAggregator;
	groupStore: GroupStore;
	sessionManager: SessionManager;
};

export function bootstrapRouterBaseline(
	router: Router,
	vault: Vault,
	services: BaselineRouterServices,
): void {
	for (const adapter of createAllAdapters(vault)) {
		router.register(adapter);
	}

	router.setCostTracker(services.costTracker);
	router.setAnalyticsAggregator(services.analyticsAggregator);
	router.setTransformerRegistry(registry);
	router.setGroupStore(services.groupStore);

	services.sessionManager.startCleanup();
	router.setSessionManager(services.sessionManager);
}
