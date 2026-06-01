import type Database from "better-sqlite3";

import { ApprovalStore } from "../approval/index.js";
import { AnalyticsAggregator, SQLiteAnalyticsWriter } from "../analytics/index.js";
import { CodeSearchService } from "../code-search/index.js";
import { ComparisonStore } from "../comparison/persistence.js";
import { CompressorService } from "../context-compression/index.js";
import { CostTracker } from "../core/cost-tracker.js";
import { GroupStore } from "../core/groups.js";
import { StateManager } from "../crdt/index.js";
import { createPageIndex } from "../pageindex/index.js";
import { PageIndexTools } from "../pageindex/tools.js";
import { SessionManager } from "../session/index.js";
import { RequestLogger } from "../logging/index.js";

export interface CoreServicesOptions {
	db: Database.Database;
	dbPath: string;
}

export interface CoreServices {
	requestLogger: RequestLogger;
	costTracker: CostTracker;
	analyticsAggregator: AnalyticsAggregator;
	groupStore: GroupStore;
	sessionManager: SessionManager;
	compressor: CompressorService;
	codeSearch: CodeSearchService;
	stateManager: StateManager;
}

export interface ToolingServices {
	approvalStore: ApprovalStore;
	pageIndex: ReturnType<typeof createPageIndex>;
	pageIndexTools: PageIndexTools;
}

export interface ComparisonServices {
	comparisonStore: ComparisonStore;
}

export function createCoreServices(options: CoreServicesOptions): CoreServices {
	const requestLogger = new RequestLogger(options.db);
	const costTracker = new CostTracker({ dbPath: options.dbPath });
	const analyticsWriter = new SQLiteAnalyticsWriter(options.db);
	const analyticsAggregator = new AnalyticsAggregator({
		persistenceWriter: analyticsWriter,
		flushIntervalMs: 5000,
	});
	const groupStore = new GroupStore(options.dbPath);
	const sessionManager = new SessionManager();
	const compressor = new CompressorService();
	const codeSearch = new CodeSearchService();
	const stateManager = new StateManager();

	return {
		requestLogger,
		costTracker,
		analyticsAggregator,
		groupStore,
		sessionManager,
		compressor,
		codeSearch,
		stateManager,
	};
}

export function createToolingServices(
	options: CoreServicesOptions,
): ToolingServices {
	const approvalStore = new ApprovalStore();
	const pageIndex = createPageIndex(options.dbPath);
	const pageIndexTools = new PageIndexTools(pageIndex.service);

	return {
		approvalStore,
		pageIndex,
		pageIndexTools,
	};
}

export function createComparisonServices(
	options: CoreServicesOptions,
): ComparisonServices {
	const comparisonStore = new ComparisonStore(options.db);

	return {
		comparisonStore,
	};
}
