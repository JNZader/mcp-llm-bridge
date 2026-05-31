import type { Hono } from "hono";

import { getLocalLLMUrls } from "../../core/local-llm-env.js";
import { localLLMEnabled } from "../../core/runtime-flags.js";
import { getLocalLLMStatus } from "../../local-llm/detector.js";
import { createCatalogFromMcpTools, type ToolSource } from "../../tool-catalog/index.js";
import { getRuntimeMcpTools } from "../mcp.js";

function getToolCatalog() {
	return createCatalogFromMcpTools(getRuntimeMcpTools());
}

export function registerToolingRoutes(app: Hono): void {
	app.get("/v1/tools/catalog", (c) => {
		try {
			const source = c.req.query("source") as ToolSource | undefined;
			const toolCatalog = getToolCatalog();
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
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.get("/v1/tools/search", (c) => {
		try {
			const query = c.req.query("q") ?? "";
			const limitStr = c.req.query("limit");
			const limit = limitStr ? parseInt(limitStr, 10) : 10;
			const toolCatalog = getToolCatalog();
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
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.get("/v1/local/models", async (c) => {
		try {
			const status = await getLocalLLMStatus({
				enabled: localLLMEnabled(),
				...getLocalLLMUrls(),
			});
			return c.json(status);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.get("/v1/balancer/strategies", async (c) => {
		try {
			const { getAllLoadBalanceModes } = await import("../../balancer/index.js");
			return c.json({ strategies: getAllLoadBalanceModes() });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});
}
