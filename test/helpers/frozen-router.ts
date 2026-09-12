import {
	BUILTIN_PROVIDER_IDS,
	normalizeProviderName,
} from "../../src/core/provider-registry.js";
import { Router } from "../../src/core/router.js";
import type { LLMProvider } from "../../src/core/types.js";

function createInertProvider(id: string): LLMProvider {
	return {
		id,
		name: `inert-${id}`,
		type: "api",
		models: [],
		async generate() {
			throw new Error("Inert provider must not generate.");
		},
		async isAvailable() {
			return false;
		},
	};
}

/** Completes only missing canonical registrations before using the real freeze lifecycle. */
export function freezeRouterForStartup(router: Router): Router {
	const registeredProviderIds = new Set(
		router.providers.map((provider) => normalizeProviderName(provider.id)),
	);

	for (const providerId of BUILTIN_PROVIDER_IDS) {
		if (!registeredProviderIds.has(providerId)) {
			router.register(createInertProvider(providerId));
		}
	}

	router.freezeProviderRegistry();
	return router;
}
