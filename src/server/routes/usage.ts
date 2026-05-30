import type { Hono } from "hono";

import type { CostTracker } from "../../core/cost-tracker.js";

export interface UsageRouteDeps {
	costTracker?: CostTracker;
}

export function registerUsageRoutes(app: Hono, deps: UsageRouteDeps): void {
	const { costTracker } = deps;

	if (!costTracker) {
		return;
	}

	app.get("/v1/usage", (c) => {
		try {
			const provider = c.req.query("provider") ?? undefined;
			const model = c.req.query("model") ?? undefined;
			const project = c.req.query("project") ?? c.req.header("X-Project") ?? undefined;
			const from = c.req.query("from") ?? undefined;
			const to = c.req.query("to") ?? undefined;
			const groupBy = c.req.query("groupBy") as
				| "provider"
				| "model"
				| "project"
				| "hour"
				| "day"
				| undefined;
			const limitStr = c.req.query("limit");
			const limit = limitStr ? parseInt(limitStr, 10) : undefined;

			const records = costTracker.query({
				provider,
				model,
				project,
				from,
				to,
				groupBy,
				limit,
			});

			return c.json({ records, count: records.length });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.get("/v1/usage/summary", (c) => {
		try {
			const provider = c.req.query("provider") ?? undefined;
			const model = c.req.query("model") ?? undefined;
			const project = c.req.query("project") ?? c.req.header("X-Project") ?? undefined;
			const from = c.req.query("from") ?? undefined;
			const to = c.req.query("to") ?? undefined;
			const groupBy = c.req.query("groupBy") as
				| "provider"
				| "model"
				| "project"
				| "hour"
				| "day"
				| undefined;

			const summary = costTracker.summary({
				provider,
				model,
				project,
				from,
				to,
				groupBy,
			});

			return c.json(summary);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});
}
