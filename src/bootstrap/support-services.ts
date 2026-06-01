import type Database from "better-sqlite3";

import type { Router } from "../core/router.js";
import type { FreeModelRouter } from "../free-models/router.js";
import {
	createToolingServices,
	type ComparisonServices,
	type ToolingServices,
} from "./core-services.js";
import {
	createComparisonContext,
	type ComparisonContext,
} from "./comparison.js";

interface CreateSupportServicesOptions {
	db: Database.Database;
	dbPath: string;
	router: Router;
	freeModelEnabled: boolean;
	freeModelRouter: FreeModelRouter;
}

export type SupportServices = ToolingServices & ComparisonServices & ComparisonContext;

export function createSupportServices(
	options: CreateSupportServicesOptions,
): SupportServices {
	const toolingServices = createToolingServices({
		db: options.db,
		dbPath: options.dbPath,
	});

	const comparisonContext = createComparisonContext({
		db: options.db,
		dbPath: options.dbPath,
		router: options.router,
		freeModelEnabled: options.freeModelEnabled,
		freeModelRouter: options.freeModelRouter,
	});

	return {
		...toolingServices,
		...comparisonContext,
	};
}
