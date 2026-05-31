import type Database from "better-sqlite3";

import { logger } from "../core/logger.js";
import {
	autoDiscoverModelsEnabled,
	localLLMEnabled,
} from "../core/runtime-flags.js";
import type { Router } from "../core/router.js";
import { LocalLLMProvider } from "../local-llm/provider.js";
import { discoverModels } from "../model-discovery/index.js";

function getLocalLLMUrls(): { ollamaUrl: string; lmStudioUrl: string } {
	return {
		ollamaUrl: process.env["OLLAMA_URL"] ?? "http://localhost:11434",
		lmStudioUrl: process.env["LM_STUDIO_URL"] ?? "http://localhost:1234",
	};
}

export async function bootstrapLocalLLM(
	router: Router,
	db: Database.Database,
): Promise<void> {
	const localLLMRuntimeEnabled = localLLMEnabled();

	if (localLLMRuntimeEnabled) {
		const localLLMProvider = new LocalLLMProvider({
			enabled: true,
			...getLocalLLMUrls(),
		});

		// Register as normal provider so it participates in routing + circuit breakers
		router.register(localLLMProvider);

		// Detect models at bootstrap
		await localLLMProvider.refreshModels();
		if (localLLMProvider.models.length > 0) {
			logger.info(
				{ models: localLLMProvider.models.map((model) => model.id) },
				"Local LLM provider active",
			);
		} else {
			logger.warn(
				"Local LLM enabled but no backends detected — will use cloud providers only",
			);
		}
	}

	if (autoDiscoverModelsEnabled() && localLLMRuntimeEnabled) {
		try {
			const discoveryResult = await discoverModels(
				{
					hfToken: process.env["HF_TOKEN"],
					enabled: true,
				},
				getLocalLLMUrls(),
				db,
			);
			logger.info(
				{
					models: discoveryResult.models.length,
					enriched: discoveryResult.enrichedCount,
					backends: discoveryResult.backendsScanned,
				},
				"Model discovery completed at bootstrap",
			);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			logger.warn({ error: msg }, "Model discovery failed at bootstrap");
		}
	}
}
