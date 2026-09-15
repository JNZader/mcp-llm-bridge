import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	BUILTIN_PROVIDER_IDS,
	PROVIDER_REGISTRY_ERROR_CODE,
	PROVIDER_REGISTRY_ERROR_MESSAGE,
	ProviderRegistryError,
} from "../../src/core/provider-registry.js";
import { Router } from "../../src/core/router.js";
import type { LLMProvider } from "../../src/core/types.js";

const EXPECTED_BUILTIN_PROVIDER_IDS = [
	"anthropic",
	"openai",
	"google",
	"groq",
	"openrouter",
	"cerebras",
	"zai",
	"nvidia",
	"mistral",
	"sambanova",
	"hyperbolic",
	"opencode-cli",
	"claude-cli",
	"antigravity-cli",
	"codex-cli",
	"qwen-cli",
	"copilot-cli",
] as const;

const EXPECTED_PROVIDER_REGISTRY_ERROR_CODE = {
	FROZEN: "PROVIDER_REGISTRY_FROZEN",
	DUPLICATE: "PROVIDER_REGISTRY_DUPLICATE",
	MISSING_REQUIRED: "PROVIDER_REGISTRY_MISSING_REQUIRED",
	NOT_FROZEN: "PROVIDER_REGISTRY_NOT_FROZEN",
} as const;

const EXPECTED_PROVIDER_REGISTRY_ERROR_MESSAGE = {
	PROVIDER_REGISTRY_FROZEN: "Provider registry is frozen.",
	PROVIDER_REGISTRY_DUPLICATE:
		"Provider registry contains duplicate provider identifiers.",
	PROVIDER_REGISTRY_MISSING_REQUIRED:
		"Provider registry is missing required providers.",
	PROVIDER_REGISTRY_NOT_FROZEN:
		"Provider registry must be frozen before startup.",
} as const;

interface RegistryErrorExpectation {
	readonly code: string;
	readonly message: string;
}

function createProvider(id: string, onAvailabilityCheck: () => void): LLMProvider {
	return {
		id,
		name: id,
		type: "api",
		models: [],
		async generate() {
			throw new Error("Generation is outside provider registry validation.");
		},
		async isAvailable() {
			onAvailabilityCheck();
			return false;
		},
	};
}

function registerBuiltins(router: Router, onAvailabilityCheck: () => void): void {
	for (const providerId of EXPECTED_BUILTIN_PROVIDER_IDS) {
		router.register(createProvider(providerId, onAvailabilityCheck));
	}
}

function isRegistryError(expected: RegistryErrorExpectation) {
	return (error: unknown): error is ProviderRegistryError =>
		error instanceof ProviderRegistryError &&
		error.code === expected.code &&
		error.message === expected.message;
}

describe("provider registry lifecycle", () => {
	it("exports immutable independent registry definitions", () => {
		assert.deepEqual(BUILTIN_PROVIDER_IDS, EXPECTED_BUILTIN_PROVIDER_IDS);
		assert.deepEqual(
			PROVIDER_REGISTRY_ERROR_CODE,
			EXPECTED_PROVIDER_REGISTRY_ERROR_CODE,
		);
		assert.deepEqual(
			PROVIDER_REGISTRY_ERROR_MESSAGE,
			EXPECTED_PROVIDER_REGISTRY_ERROR_MESSAGE,
		);
		assert.equal(Object.isFrozen(BUILTIN_PROVIDER_IDS), true);
		assert.equal(Object.isFrozen(PROVIDER_REGISTRY_ERROR_CODE), true);
		assert.equal(Object.isFrozen(PROVIDER_REGISTRY_ERROR_MESSAGE), true);

		assert.throws(
			() => (BUILTIN_PROVIDER_IDS as unknown as string[]).push("unexpected"),
			TypeError,
		);
		assert.throws(
			() => {
				(PROVIDER_REGISTRY_ERROR_CODE as { FROZEN: string }).FROZEN = "unexpected";
			},
			TypeError,
		);
		assert.throws(
			() => {
				(PROVIDER_REGISTRY_ERROR_MESSAGE as {
					PROVIDER_REGISTRY_FROZEN: string;
				}).PROVIDER_REGISTRY_FROZEN = "unexpected";
			},
			TypeError,
		);
		assert.deepEqual(BUILTIN_PROVIDER_IDS, EXPECTED_BUILTIN_PROVIDER_IDS);
	});

	it("freezes all required builtins without a local provider", () => {
		const router = new Router();
		registerBuiltins(router, () => undefined);

		router.freezeProviderRegistry();

		assert.equal(router.providerRegistryFrozen, true);
		assert.equal(router.providers.length, EXPECTED_BUILTIN_PROVIDER_IDS.length);
	});

	it("freezes the required builtin registry while allowing an optional local provider", () => {
		let availabilityChecks = 0;
		const router = new Router();
		registerBuiltins(router, () => {
			availabilityChecks += 1;
		});
		router.register(createProvider("local-llm", () => {
			availabilityChecks += 1;
		}));
		assert.equal(router.providerRegistryFrozen, false);

		router.freezeProviderRegistry();

		const exposedProviders = router.providers;
		exposedProviders.pop();
		assert.equal(router.providers.length, EXPECTED_BUILTIN_PROVIDER_IDS.length + 1);
		assert.equal(router.providerRegistryFrozen, true);
		assert.equal(availabilityChecks, 0);
		assert.throws(
			() => router.register(createProvider("late", () => undefined)),
			isRegistryError({
				code: EXPECTED_PROVIDER_REGISTRY_ERROR_CODE.FROZEN,
				message: EXPECTED_PROVIDER_REGISTRY_ERROR_MESSAGE.PROVIDER_REGISTRY_FROZEN,
			}),
		);
		assert.throws(
			() => router.unregister("local-llm"),
			isRegistryError({
				code: EXPECTED_PROVIDER_REGISTRY_ERROR_CODE.FROZEN,
				message: EXPECTED_PROVIDER_REGISTRY_ERROR_MESSAGE.PROVIDER_REGISTRY_FROZEN,
			}),
		);
		assert.equal(router.providers.length, EXPECTED_BUILTIN_PROVIDER_IDS.length + 1);
	});

	it("rejects missing required builtins atomically without invoking availability", () => {
		let availabilityChecks = 0;
		const router = new Router();
		for (const providerId of EXPECTED_BUILTIN_PROVIDER_IDS.slice(1)) {
			router.register(createProvider(providerId, () => {
				availabilityChecks += 1;
			}));
		}

		assert.throws(
			() => router.freezeProviderRegistry(),
			isRegistryError({
				code: EXPECTED_PROVIDER_REGISTRY_ERROR_CODE.MISSING_REQUIRED,
				message:
					EXPECTED_PROVIDER_REGISTRY_ERROR_MESSAGE.PROVIDER_REGISTRY_MISSING_REQUIRED,
			}),
		);
		assert.equal(router.providerRegistryFrozen, false);
		assert.equal(router.providers.length, EXPECTED_BUILTIN_PROVIDER_IDS.length - 1);
		assert.equal(availabilityChecks, 0);
		router.register(
			createProvider(EXPECTED_BUILTIN_PROVIDER_IDS[0], () => undefined),
		);
		assert.equal(router.providers.length, EXPECTED_BUILTIN_PROVIDER_IDS.length);
	});

	it("rejects canonical alias duplicates without freezing the registry", () => {
		const router = new Router();
		registerBuiltins(router, () => undefined);
		router.register(createProvider("opencode", () => undefined));

		assert.throws(
			() => router.freezeProviderRegistry(),
			isRegistryError({
				code: EXPECTED_PROVIDER_REGISTRY_ERROR_CODE.DUPLICATE,
				message:
					EXPECTED_PROVIDER_REGISTRY_ERROR_MESSAGE.PROVIDER_REGISTRY_DUPLICATE,
			}),
		);
		assert.equal(router.providerRegistryFrozen, false);
		router.unregister("opencode");
		router.freezeProviderRegistry();
		assert.equal(router.providerRegistryFrozen, true);
	});
});
