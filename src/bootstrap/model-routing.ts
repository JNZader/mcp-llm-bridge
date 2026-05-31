import { logger } from "../core/logger.js";
import { modelRoutingEnabled } from "../core/runtime-flags.js";
import type { Router } from "../core/router.js";

export async function bootstrapModelRouting(router: Router): Promise<void> {
	if (!modelRoutingEnabled()) {
		return;
	}

	const { bootstrapModelRouter } = await import("../model-routing/index.js");
	const modelRouter = bootstrapModelRouter(router.providers);
	if (modelRouter) {
		router.setModelRouter(modelRouter);
		logger.info("Model routing enabled");
	} else {
		logger.warn("Model routing config missing or disabled");
	}
}
