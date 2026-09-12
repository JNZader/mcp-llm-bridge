import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	composeRuntimeContext,
	type RuntimeCompositionDependencies,
} from "../../src/bootstrap/runtime-composition.js";
import type { RuntimeFoundation } from "../../src/bootstrap/runtime-foundation.js";
import type { RouterFeaturesBootstrapResult } from "../../src/bootstrap/router-features.js";
import type { SupportServices } from "../../src/bootstrap/support-services.js";
import type { PluginRuntimeRegistry } from "../../src/mcp-builder/plugin-runtime-registry.js";

const FAILURE_STAGES = [
	"foundation",
	"features",
	"local",
	"freeze",
	"support",
	"registry",
] as const;

type FailureStage = (typeof FAILURE_STAGES)[number];

function opaque<T>(): T {
	return Object.create(null) as T;
}

interface CompositionHarness {
	dependencies: RuntimeCompositionDependencies;
	calls: string[];
	error: Error;
	foundation: RuntimeFoundation;
	features: RouterFeaturesBootstrapResult;
	registry: PluginRuntimeRegistry;
	supportMarker: object;
}

function createHarness(failureAt?: FailureStage): CompositionHarness {
	const calls: string[] = [];
	const error = new Error(`failed at ${failureAt ?? "never"}`);
	const coreMarker = {};
	const supportMarker = {};
	function reached(stage: FailureStage): void {
		calls.push(stage);
		if (failureAt === stage) {
			throw error;
		}
	}

	const router = {
		freezeProviderRegistry() {
			reached("freeze");
		},
	} as unknown as RuntimeFoundation["router"];
	const foundation = {
		config: opaque<RuntimeFoundation["config"]>(),
		vault: opaque<RuntimeFoundation["vault"]>(),
		router,
		db: opaque<RuntimeFoundation["db"]>(),
		coreServices: { marker: coreMarker } as unknown as RuntimeFoundation["coreServices"],
	} satisfies RuntimeFoundation;
	const features = {
		freeModelEnabled: true,
		freeModelRouter: opaque<RouterFeaturesBootstrapResult["freeModelRouter"]>(),
		latencyMeasurer: opaque<RouterFeaturesBootstrapResult["latencyMeasurer"]>(),
		bridgeConfig: opaque<RouterFeaturesBootstrapResult["bridgeConfig"]>(),
		bridge: opaque<RouterFeaturesBootstrapResult["bridge"]>(),
	} satisfies RouterFeaturesBootstrapResult;
	const supportServices = {
		marker: supportMarker,
	} as unknown as SupportServices;
	const registry = opaque<PluginRuntimeRegistry>();

	const dependencies = {
		async createRuntimeFoundation() {
			reached("foundation");
			return foundation;
		},
		async bootstrapRouterFeatures(router, vault, coreServices) {
			reached("features");
			assert.equal(router, foundation.router);
			assert.equal(vault, foundation.vault);
			assert.equal(coreServices, foundation.coreServices);
			return features;
		},
		async bootstrapLocalLLM(router, db) {
			reached("local");
			assert.equal(router, foundation.router);
			assert.equal(db, foundation.db);
		},
		createSupportServices(options) {
			reached("support");
			assert.deepEqual(options, {
				db: foundation.db,
				dbPath: foundation.config.dbPath,
				router: foundation.router,
				freeModelEnabled: features.freeModelEnabled,
				freeModelRouter: features.freeModelRouter,
			});
			return supportServices;
		},
		createPluginRuntimeRegistry() {
			reached("registry");
			return registry;
		},
	} satisfies RuntimeCompositionDependencies;

	return {
		dependencies,
		calls,
		error,
		foundation,
		features,
		registry,
		supportMarker,
	};
}

describe("composeRuntimeContext", () => {
	it("orders the production composition and preserves assembled references", async () => {
		const harness = createHarness();

		const context = await composeRuntimeContext(harness.dependencies);

		assert.deepEqual(harness.calls, FAILURE_STAGES);
		assert.equal(context.config, harness.foundation.config);
		assert.equal(context.vault, harness.foundation.vault);
		assert.equal(context.router, harness.foundation.router);
		assert.equal(context.db, harness.foundation.db);
		assert.equal(context.bridgeConfig, harness.features.bridgeConfig);
		assert.equal(context.bridge, harness.features.bridge);
		assert.equal(context.freeModelEnabled, harness.features.freeModelEnabled);
		assert.equal(context.freeModelRouter, harness.features.freeModelRouter);
		assert.equal(context.latencyMeasurer, harness.features.latencyMeasurer);
		assert.equal(context.pluginRuntimeRegistry, harness.registry);
		assert.equal(
			(context as unknown as { marker?: object }).marker,
			harness.supportMarker,
		);
	});

	it("preserves failure identity and short-circuits every composition stage", async () => {
		for (const failureAt of FAILURE_STAGES) {
			const harness = createHarness(failureAt);

			await assert.rejects(
				composeRuntimeContext(harness.dependencies),
				(error: unknown) => error === harness.error,
			);
			assert.deepEqual(
				harness.calls,
				FAILURE_STAGES.slice(0, FAILURE_STAGES.indexOf(failureAt) + 1),
			);
		}
	});
});
