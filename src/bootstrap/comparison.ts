import type Database from "better-sqlite3";

import { ComparisonService } from "../comparison/service.js";
import { getMaxComparisonCostUsdFromEnv } from "../core/comparison-config.js";
import type { Router } from "../core/router.js";
import type { FreeModelRouter } from "../free-models/router.js";
import {
	createComparisonServices,
	type ComparisonServices,
} from "./core-services.js";

interface CreateComparisonContextOptions {
	db: Database.Database;
	dbPath: string;
	router: Router;
	freeModelEnabled: boolean;
	freeModelRouter: FreeModelRouter;
}

export interface ComparisonContext {
	comparisonService: ComparisonService;
}

export function createComparisonContext(
	options: CreateComparisonContextOptions,
): ComparisonServices & ComparisonContext {
	const comparisonServices = createComparisonServices({
		db: options.db,
		dbPath: options.dbPath,
	});

	const comparisonService = new ComparisonService(options.router, {
		freeModelRegistry: options.freeModelEnabled
			? options.freeModelRouter.getRegistry()
			: undefined,
		store: comparisonServices.comparisonStore,
		maxCostCeiling: getMaxComparisonCostUsdFromEnv(),
	});

	return {
		...comparisonServices,
		comparisonService,
	};
}
