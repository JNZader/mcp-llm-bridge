import { logger } from "../core/logger.js";
import { freeModelCatalogEnabled } from "../core/runtime-flags.js";
import type { Router } from "../core/router.js";
import {
	FreeModelRouter,
	importCatalog,
	loadCatalog,
} from "../free-models/index.js";

interface FreeModelsBootstrapResult {
	freeModelEnabled: boolean;
	freeModelRouter: FreeModelRouter;
}

export function bootstrapFreeModels(
	router: Router,
): FreeModelsBootstrapResult {
	const freeModelEnabled = process.env["FALLBACK_STRATEGY"] === "free-models";
	const freeModelRouter = new FreeModelRouter({ enabled: freeModelEnabled });

	if (freeModelEnabled) {
		router.setFreeModelRouter(freeModelRouter);
		logger.info("Free model fallback routing enabled");
	}

	if (freeModelCatalogEnabled()) {
		const catalog = loadCatalog();
		if (catalog) {
			const entries = importCatalog(catalog, freeModelRouter.getHealthChecker());
			const imported = freeModelRouter.getRegistry().importModels(entries);
			logger.info({ imported }, "Free model catalog loaded at startup");
		}
	}

	return {
		freeModelEnabled,
		freeModelRouter,
	};
}
