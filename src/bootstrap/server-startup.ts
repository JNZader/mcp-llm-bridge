import {
	startHttpServerWithDeps,
	type StartHttpServerDeps,
} from "../server/http.js";
import {
	startMcpServer,
	type StartMcpServerDeps,
} from "../server/mcp.js";
import type { RuntimeContext } from "./runtime-context.js";
import type { TransportHandles } from "./shutdown.js";

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
): TransportHandles {
	return { httpServer: deps.startHttpServerWithDeps(buildHttpServerDeps(runtime)) };
}

export function startHttpOnlyMode(
	runtime: ServerStartupRuntime,
	deps: ServerStartupDeps = DEFAULT_SERVER_STARTUP_DEPS,
): TransportHandles {
	return startServeMode(runtime, deps);
}

export async function startDefaultMcpMode(
	runtime: ServerStartupRuntime,
	deps: ServerStartupDeps = DEFAULT_SERVER_STARTUP_DEPS,
): Promise<TransportHandles> {
	const mcpServer = await deps.startMcpServer(buildMcpServerDeps(runtime));
	return { mcpServer };
}

export async function startConfiguredMode(
	runtime: ServerStartupRuntime,
	mode: string | undefined,
	deps: ServerStartupDeps = DEFAULT_SERVER_STARTUP_DEPS,
): Promise<TransportHandles> {
	if (mode === "serve") {
		return startServeMode(runtime, deps);
	}

	const mcp = await startDefaultMcpMode(runtime, deps);
	if (mode === "--http") {
		return { ...mcp, ...startHttpOnlyMode(runtime, deps) };
	}
	return mcp;
}
