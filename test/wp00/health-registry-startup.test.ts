import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Router } from "../../src/core/router.js";
import type { LLMProvider } from "../../src/core/types.js";
import {
	startHttpServerWithDeps,
	type StartHttpServerDeps,
} from "../../src/server/http.js";
import {
	startMcpServer,
	type StartMcpServerOptions,
} from "../../src/server/mcp-server.js";
import { freezeRouterForStartup } from "../helpers/frozen-router.js";

const EXPECTED_BUILTIN_PROVIDER_IDS = [
	"anthropic", "openai", "google", "groq", "openrouter", "cerebras", "zai",
	"nvidia", "mistral", "sambanova", "hyperbolic", "opencode-cli", "claude-cli",
	"antigravity-cli", "codex-cli", "qwen-cli", "copilot-cli",
] as const;
const EXPECTED_NOT_FROZEN = {
	code: "PROVIDER_REGISTRY_NOT_FROZEN",
	message: "Provider registry must be frozen before startup.",
} as const;

function trapDependencies(router: Router) {
	let reads = 0;
	const sentinel = new Error("startup dependency was read");
	const target = { router };
	const proxy = new Proxy(target, {
		get(value, property, receiver) {
			if (property === "router") {
				return Reflect.get(value, property, receiver);
			}
			reads += 1;
			throw sentinel;
		},
	});
	return { proxy, sentinel, getReads: () => reads };
}

function isNotFrozen(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		"message" in error &&
		(error as { code: unknown }).code === EXPECTED_NOT_FROZEN.code &&
		(error as { message: unknown }).message === EXPECTED_NOT_FROZEN.message
	);
}

function existingProvider(id: string, onAvailability: () => void): LLMProvider {
	return {
		id,
		name: id,
		type: "api",
		models: [],
		async generate() {
			throw new Error("Existing provider must not generate.");
		},
		async isAvailable() {
			onAvailability();
			return false;
		},
	};
}

describe("provider registry startup guards", () => {
	it("supplements only missing canonical providers and freezes the real router", () => {
		let availabilityCalls = 0;
		const router = new Router();
		const existing = existingProvider("opencode", () => {
			availabilityCalls += 1;
		});
		router.register(existing);

		const frozenRouter = freezeRouterForStartup(router);
		const providers = frozenRouter.providers;

		assert.equal(frozenRouter, router);
		assert.equal(frozenRouter.providerRegistryFrozen, true);
		assert.equal(providers[0], existing);
		assert.equal(providers[0]?.id, "opencode");
		assert.equal(providers.some((provider) => provider.id === "opencode-cli"), false);
		assert.equal(providers.length, EXPECTED_BUILTIN_PROVIDER_IDS.length);
		assert.deepEqual(
			new Set(
				providers.map((provider) =>
					provider.id === "opencode" ? "opencode-cli" : provider.id,
				),
			),
			new Set(EXPECTED_BUILTIN_PROVIDER_IDS),
		);
		assert.equal(availabilityCalls, 0);
	});

	it("rejects an unfrozen HTTP router before reading any other dependency", () => {
		const trapped = trapDependencies(new Router());
		assert.throws(
			() => startHttpServerWithDeps(trapped.proxy as unknown as StartHttpServerDeps),
			isNotFrozen,
		);
		assert.equal(trapped.getReads(), 0);
	});

	it("allows a frozen HTTP router to reach the first dependency sentinel", () => {
		const trapped = trapDependencies(freezeRouterForStartup(new Router()));
		assert.throws(
			() => startHttpServerWithDeps(trapped.proxy as unknown as StartHttpServerDeps),
			(error: unknown) => error === trapped.sentinel,
		);
		assert.equal(trapped.getReads(), 1);
	});

	it("rejects an unfrozen MCP router before reading any other dependency", async () => {
		const trapped = trapDependencies(new Router());
		await assert.rejects(
			startMcpServer(trapped.proxy as unknown as StartMcpServerOptions),
			isNotFrozen,
		);
		assert.equal(trapped.getReads(), 0);
	});

	it("allows a frozen MCP router to reach the first dependency sentinel", async () => {
		const trapped = trapDependencies(freezeRouterForStartup(new Router()));
		await assert.rejects(
			startMcpServer(trapped.proxy as unknown as StartMcpServerOptions),
			(error: unknown) => error === trapped.sentinel,
		);
		assert.equal(trapped.getReads(), 1);
	});
});
