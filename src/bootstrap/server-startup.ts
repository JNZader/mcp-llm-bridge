import {
	startHttpServerWithDeps,
	type StartHttpServerDeps,
} from "../server/http.js";
import {
	startMcpServer,
	type StartMcpServerDeps,
} from "../server/mcp.js";
import type { RuntimeContext } from "./runtime-context.js";

export interface ServerStartupDeps {
	startHttpServerWithDeps: typeof startHttpServerWithDeps;
	startMcpServer: typeof startMcpServer;
}

export type ServerStartupRuntime = Pick<
	RuntimeContext,
	| "router"
	| "vault"
	| "config"
	| "groupStore"
	| "costTracker"
	| "latencyMeasurer"
	| "freeModelRouter"
	| "db"
	| "analyticsAggregator"
	| "comparisonService"
	| "approvalStore"
	| "sessionManager"
	| "requestLogger"
	| "bridge"
	| "codeSearch"
	| "stateManager"
	| "pageIndexTools"
>;

const DEFAULT_SERVER_STARTUP_DEPS: ServerStartupDeps = {
	startHttpServerWithDeps,
	startMcpServer,
};

export function buildHttpServerDeps(
	runtime: ServerStartupRuntime,
): StartHttpServerDeps {
	return {
		router: runtime.router,
		vault: runtime.vault,
		config: runtime.config,
		groupStore: runtime.groupStore,
		costTracker: runtime.costTracker,
		latencyMeasurer: runtime.latencyMeasurer,
		freeModelRouter: runtime.freeModelRouter,
		db: runtime.db,
		analyticsAggregator: runtime.analyticsAggregator,
		comparisonService: runtime.comparisonService,
		securityProfile: runtime.config.securityProfile,
		approvalStore: runtime.approvalStore,
		sessionManager: runtime.sessionManager,
		requestLogger: runtime.requestLogger,
	};
}

export function buildMcpServerDeps(
	runtime: ServerStartupRuntime,
): StartMcpServerDeps {
	return {
		router: runtime.router,
		vault: runtime.vault,
		costTracker: runtime.costTracker,
		bridge: runtime.bridge,
		codeSearch: runtime.codeSearch,
		stateManager: runtime.stateManager,
		securityProfile: runtime.config.securityProfile,
		approvalStore: runtime.approvalStore,
		pageIndexTools: runtime.pageIndexTools,
	};
}

export function startServeMode(
	runtime: ServerStartupRuntime,
	deps: ServerStartupDeps = DEFAULT_SERVER_STARTUP_DEPS,
): void {
	deps.startHttpServerWithDeps(buildHttpServerDeps(runtime));
}

export function startHttpOnlyMode(
	runtime: ServerStartupRuntime,
	deps: ServerStartupDeps = DEFAULT_SERVER_STARTUP_DEPS,
): void {
	deps.startHttpServerWithDeps(buildHttpServerDeps(runtime));
}

export async function startDefaultMcpMode(
	runtime: ServerStartupRuntime,
	deps: ServerStartupDeps = DEFAULT_SERVER_STARTUP_DEPS,
): Promise<void> {
	await deps.startMcpServer(buildMcpServerDeps(runtime));
}

export async function startConfiguredMode(
	runtime: ServerStartupRuntime,
	mode: string | undefined,
	deps: ServerStartupDeps = DEFAULT_SERVER_STARTUP_DEPS,
): Promise<void> {
	if (mode === "serve") {
		startServeMode(runtime, deps);
		return;
	}

	await startDefaultMcpMode(runtime, deps);
	if (mode === "--http") {
		startHttpOnlyMode(runtime, deps);
	}
}
