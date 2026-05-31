import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	buildHttpServerDeps,
	buildMcpServerDeps,
	startConfiguredMode,
	type ServerStartupDeps,
	type ServerStartupRuntime,
} from "../../src/bootstrap/server-startup.js";

type StartHttpServerResult = ReturnType<
	ServerStartupDeps["startHttpServerWithDeps"]
>;
type StartMcpServerResult = Awaited<
	ReturnType<ServerStartupDeps["startMcpServer"]>
>;

function createRuntimeStub(): ServerStartupRuntime {
	return {
		router: { name: "router" } as unknown as ServerStartupRuntime["router"],
		vault: { name: "vault" } as unknown as ServerStartupRuntime["vault"],
		config: {
			securityProfile: "local-dev",
		} as unknown as ServerStartupRuntime["config"],
		groupStore: { name: "groupStore" } as unknown as ServerStartupRuntime["groupStore"],
		costTracker: { name: "costTracker" } as unknown as ServerStartupRuntime["costTracker"],
		latencyMeasurer: { name: "latencyMeasurer" } as unknown as ServerStartupRuntime["latencyMeasurer"],
		freeModelRouter: { name: "freeModelRouter" } as unknown as ServerStartupRuntime["freeModelRouter"],
		db: { name: "db" } as unknown as ServerStartupRuntime["db"],
		analyticsAggregator: { name: "analyticsAggregator" } as unknown as ServerStartupRuntime["analyticsAggregator"],
		comparisonService: { name: "comparisonService" } as unknown as ServerStartupRuntime["comparisonService"],
		approvalStore: { name: "approvalStore" } as unknown as ServerStartupRuntime["approvalStore"],
		sessionManager: { name: "sessionManager" } as unknown as ServerStartupRuntime["sessionManager"],
		requestLogger: { name: "requestLogger" } as unknown as ServerStartupRuntime["requestLogger"],
		bridge: { name: "bridge" } as unknown as ServerStartupRuntime["bridge"],
		codeSearch: { name: "codeSearch" } as unknown as ServerStartupRuntime["codeSearch"],
		stateManager: { name: "stateManager" } as unknown as ServerStartupRuntime["stateManager"],
		pageIndexTools: { name: "pageIndexTools" } as unknown as ServerStartupRuntime["pageIndexTools"],
	};
}

describe("server startup bootstrap", () => {
	it("buildHttpServerDeps preserves the HTTP dependency wiring", () => {
		const runtime = createRuntimeStub();

		assert.deepEqual(buildHttpServerDeps(runtime), {
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
		});
	});

	it("buildMcpServerDeps preserves the MCP dependency wiring", () => {
		const runtime = createRuntimeStub();

		assert.deepEqual(buildMcpServerDeps(runtime), {
			router: runtime.router,
			vault: runtime.vault,
			costTracker: runtime.costTracker,
			bridge: runtime.bridge,
			codeSearch: runtime.codeSearch,
			stateManager: runtime.stateManager,
			securityProfile: runtime.config.securityProfile,
			approvalStore: runtime.approvalStore,
			pageIndexTools: runtime.pageIndexTools,
		});
	});

	it("serve mode starts only HTTP", async () => {
		const runtime = createRuntimeStub();
		const calls: string[] = [];

		await startConfiguredMode(runtime, "serve", {
			startHttpServerWithDeps: () => {
				calls.push("http");
				return {} as StartHttpServerResult;
			},
			startMcpServer: async () => {
				calls.push("mcp");
				return {} as StartMcpServerResult;
			},
		});

		assert.deepEqual(calls, ["http"]);
	});

	it("http mode starts MCP first and then HTTP", async () => {
		const runtime = createRuntimeStub();
		const calls: string[] = [];

		await startConfiguredMode(runtime, "--http", {
			startHttpServerWithDeps: () => {
				calls.push("http");
				return {} as StartHttpServerResult;
			},
			startMcpServer: async () => {
				calls.push("mcp");
				return {} as StartMcpServerResult;
			},
		});

		assert.deepEqual(calls, ["mcp", "http"]);
	});

	it("default mode starts only MCP", async () => {
		const runtime = createRuntimeStub();
		const calls: string[] = [];

		await startConfiguredMode(runtime, undefined, {
			startHttpServerWithDeps: () => {
				calls.push("http");
				return {} as StartHttpServerResult;
			},
			startMcpServer: async () => {
				calls.push("mcp");
				return {} as StartMcpServerResult;
			},
		});

		assert.deepEqual(calls, ["mcp"]);
	});
});
