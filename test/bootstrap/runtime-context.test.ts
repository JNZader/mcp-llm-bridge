import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { describe, it } from "node:test";

import { createRuntimeContext } from "../../src/bootstrap/runtime-context.js";
import { registry } from "../../src/core/transformer.js";

const ENV_KEYS = [
	"LLM_GATEWAY_MASTER_KEY",
	"LLM_GATEWAY_DB_PATH",
	"LLM_GATEWAY_PORT",
	"LLM_GATEWAY_AUTH_REQUIRED",
	"LLM_GATEWAY_SECURITY_PROFILE",
	"MODEL_ROUTING_ENABLED",
	"LATENCY_ROUTING",
	"FREE_MODEL_CATALOG",
	"FALLBACK_STRATEGY",
	"LOCAL_LLM_ENABLED",
	"AUTO_DISCOVER_MODELS",
] as const;

function cleanupDb(dbPath: string): void {
	for (const suffix of ["", "-wal", "-shm"]) {
		const filePath = dbPath + suffix;
		if (existsSync(filePath)) {
			unlinkSync(filePath);
		}
	}
}

describe("createRuntimeContext", () => {
	it("assembles the shared runtime graph with the existing wiring", async () => {
		const previousEnv = new Map<string, string | undefined>();
		for (const key of ENV_KEYS) {
			previousEnv.set(key, process.env[key]);
		}

		const dbPath = `/tmp/test-runtime-context-${Date.now()}.db`;
		process.env.LLM_GATEWAY_MASTER_KEY = randomBytes(32).toString("hex");
		process.env.LLM_GATEWAY_DB_PATH = dbPath;
		process.env.LLM_GATEWAY_PORT = "4310";
		process.env.LLM_GATEWAY_AUTH_REQUIRED = "false";
		process.env.LLM_GATEWAY_SECURITY_PROFILE = "local-dev";
		process.env.MODEL_ROUTING_ENABLED = "false";
		process.env.LATENCY_ROUTING = "false";
		process.env.FREE_MODEL_CATALOG = "false";
		delete process.env.FALLBACK_STRATEGY;
		process.env.LOCAL_LLM_ENABLED = "false";
		process.env.AUTO_DISCOVER_MODELS = "false";

		let runtime: Awaited<ReturnType<typeof createRuntimeContext>> | null = null;

		try {
			runtime = await createRuntimeContext();

			assert.equal(runtime.config.dbPath, dbPath);
			assert.equal(runtime.db, runtime.vault.getDb());
			assert.ok(runtime.router.providers.length > 0);
			assert.equal(runtime.router.costTracker, runtime.costTracker);
			assert.equal(
				runtime.router.analyticsAggregator,
				runtime.analyticsAggregator,
			);
			assert.equal(runtime.router.transformerRegistry, registry);
			assert.equal(runtime.router.groupStore, runtime.groupStore);
			assert.equal(runtime.router.sessionManager, runtime.sessionManager);
			assert.equal(runtime.router.modelRouter, null);
			assert.equal(runtime.bridge, null);
			assert.ok(runtime.freeModelRouter);
			assert.ok(runtime.latencyMeasurer);
			assert.ok(runtime.approvalStore);
			assert.ok(runtime.pageIndex.service);
			assert.ok(runtime.pageIndexTools);
			assert.ok(runtime.comparisonStore);
			assert.ok(runtime.comparisonService);
			assert.notEqual(
				(runtime.sessionManager as unknown as { cleanupTimer?: unknown })
					.cleanupTimer,
				undefined,
			);
		} finally {
			if (runtime) {
				runtime.compressor.destroy();
				runtime.latencyMeasurer.stopBackgroundTask();
				runtime.freeModelRouter.destroy();
				runtime.costTracker.destroy();
				runtime.groupStore.close();
				runtime.sessionManager.destroy();
				runtime.pageIndex.service.close();
				runtime.vault.destroy();
			}
			cleanupDb(dbPath);

			for (const key of ENV_KEYS) {
				const value = previousEnv.get(key);
				if (value === undefined) {
					delete process.env[key];
				} else {
					process.env[key] = value;
				}
			}
		}
	});
});
