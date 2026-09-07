import type { Hono } from "hono";
import type { getAllLoadBalanceModes } from "../../balancer/index.js";

import { getLocalLLMUrls } from "../../core/local-llm-env.js";
import { localLLMEnabled } from "../../core/runtime-flags.js";
import { safeError } from "../../core/safe-error.js";
import { getLocalLLMStatus } from "../../local-llm/detector.js";
import { createCatalogFromMcpTools, type ToolCatalog, type ToolSource } from "../../tool-catalog/index.js";
import { getRuntimeMcpTools } from "../mcp.js";

function getToolCatalog() {
	return createCatalogFromMcpTools(getRuntimeMcpTools());
}

export interface ToolingRouteDeps {
	getLocalLLMStatus?: typeof getLocalLLMStatus;
	getToolCatalog?: () => Pick<ToolCatalog, "listAll" | "search">;
	getStrategies?: () => Promise<ReturnType<typeof getAllLoadBalanceModes>>;
}

export function registerToolingRoutes(
	app: Hono,
	deps: ToolingRouteDeps = {},
): void {
	const readLocalLLMStatus = deps.getLocalLLMStatus ?? getLocalLLMStatus;
	const readToolCatalog = deps.getToolCatalog ?? getToolCatalog;
	const readStrategies = deps.getStrategies ?? (async () => {
		const { getAllLoadBalanceModes } = await import("../../balancer/index.js");
		return getAllLoadBalanceModes();
	});
	app.get("/v1/tools/catalog", (c) => {
		try {
			const source = c.req.query("source") as ToolSource | undefined;
			const toolCatalog = readToolCatalog();
			const tools = toolCatalog.listAll(source);
			return c.json({
				count: tools.length,
				tools: tools.map((t) => ({
					name: t.name,
					namespace: t.namespace,
					source: t.source,
					description: t.description,
					parameters: t.parameters,
					tags: t.tags,
					addedAt: t.addedAt,
				})),
			});
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
	});

	app.get("/v1/tools/search", (c) => {
		try {
			const query = c.req.query("q") ?? "";
			const limitStr = c.req.query("limit");
			const limit = limitStr ? parseInt(limitStr, 10) : 10;
			const toolCatalog = readToolCatalog();
			const results = toolCatalog.search(query, isNaN(limit) ? 10 : limit);
			return c.json({
				query,
				count: results.length,
				tools: results.map((t) => ({
					name: t.name,
					namespace: t.namespace,
					source: t.source,
					description: t.description,
					parameters: t.parameters,
					tags: t.tags,
				})),
			});
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
	});

	app.get("/v1/local/models", async (c) => {
		try {
			const enabled = localLLMEnabled();
			const status = await readLocalLLMStatus({
				enabled,
				...getLocalLLMUrls(),
			}, enabled ? undefined : { skipDetectionWhenDisabled: true });
			return c.json({
				enabled: status.enabled,
				ready: status.ready,
				readyReason: status.readyReason,
				checkedAt: status.checkedAt,
				source: status.source,
				cacheHit: status.cacheHit,
				backendCount: status.backendCount,
				connectedBackendCount: status.connectedBackendCount,
				disconnectedBackendCount: status.disconnectedBackendCount,
				errorBackendCount: status.errorBackendCount,
				modelCount: status.modelCount,
				backends: status.backends.map((backend) => {
					const diagnostic = Object.getOwnPropertyDescriptor(backend, "error");
					let error: string | null | undefined;
					if (diagnostic !== undefined) {
						if ("value" in diagnostic && diagnostic.value === null) error = null;
						else if (!("value" in diagnostic) || diagnostic.value !== undefined) {
							error = safeError("INTERNAL_ERROR").message;
						}
					}
					return {
						backend: backend.backend,
						status: backend.status,
						baseUrl: backend.baseUrl,
						modelCount: backend.modelCount,
						models: backend.models.map((model) => ({
							id: model.id,
							name: model.name,
							backend: model.backend,
							parameterSize: model.parameterSize,
							contextWindow: model.contextWindow,
							loaded: model.loaded,
						})),
						error,
					};
				}),
			});
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
	});

	app.get("/v1/balancer/strategies", async (c) => {
		try {
			return c.json({ strategies: await readStrategies() });
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
	});
}
