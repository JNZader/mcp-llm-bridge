import type { Hono } from "hono";

import { getCircuitBreakerRegistry } from "../../core/circuit-breaker.js";

export function registerCircuitBreakerRoutes(app: Hono): void {
	app.get("/v1/circuit-breaker/config", (c) => {
		try {
			const cbRegistry = getCircuitBreakerRegistry();
			const config = cbRegistry.getDefaultConfig();
			return c.json({
				enabled: cbRegistry.isEnabled(),
				failureThreshold: config.failureThreshold,
				backoffBaseMs: config.backoffBaseMs,
				backoffMultiplier: config.backoffMultiplier,
				backoffMaxMs: config.backoffMaxMs,
				resetTimeoutMs: config.resetTimeoutMs,
				halfOpenSuccessThreshold: config.halfOpenSuccessThreshold,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.put("/v1/circuit-breaker/config", async (c) => {
		try {
			const body = await c.req.json();
			const cbRegistry = getCircuitBreakerRegistry();

			const update: Record<string, unknown> = {};
			if (
				typeof body.failureThreshold === "number" &&
				body.failureThreshold > 0
			) {
				update["failureThreshold"] = body.failureThreshold;
			}
			if (typeof body.backoffBaseMs === "number" && body.backoffBaseMs > 0) {
				update["backoffBaseMs"] = body.backoffBaseMs;
			}
			if (
				typeof body.backoffMultiplier === "number" &&
				body.backoffMultiplier > 0
			) {
				update["backoffMultiplier"] = body.backoffMultiplier;
			}
			if (typeof body.backoffMaxMs === "number" && body.backoffMaxMs > 0) {
				update["backoffMaxMs"] = body.backoffMaxMs;
			}
			if (typeof body.resetTimeoutMs === "number" && body.resetTimeoutMs > 0) {
				update["resetTimeoutMs"] = body.resetTimeoutMs;
			}
			if (
				typeof body.halfOpenSuccessThreshold === "number" &&
				body.halfOpenSuccessThreshold > 0
			) {
				update["halfOpenSuccessThreshold"] = body.halfOpenSuccessThreshold;
			}

			if (Object.keys(update).length === 0) {
				return c.json(
					{
						error: "No valid config fields provided",
						code: "VALIDATION_ERROR",
					},
					400,
				);
			}

			cbRegistry.updateDefaultConfig(update as Record<string, number>);
			const newConfig = cbRegistry.getDefaultConfig();
			return c.json({
				updated: true,
				config: {
					enabled: cbRegistry.isEnabled(),
					failureThreshold: newConfig.failureThreshold,
					backoffBaseMs: newConfig.backoffBaseMs,
					backoffMultiplier: newConfig.backoffMultiplier,
					backoffMaxMs: newConfig.backoffMaxMs,
					resetTimeoutMs: newConfig.resetTimeoutMs,
					halfOpenSuccessThreshold: newConfig.halfOpenSuccessThreshold,
				},
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.get("/v1/circuit-breaker/stats", (c) => {
		try {
			const cbRegistry = getCircuitBreakerRegistry();
			const stats = cbRegistry.getAllStats();
			return c.json({
				enabled: cbRegistry.isEnabled(),
				breakers: stats,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});
}
