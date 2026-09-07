import type { Hono } from "hono";
import { safeError } from "../../core/safe-error.js";

import {
	type LegacyCircuitBreakerConfigView,
	getCircuitBreakerAdminConfig,
	getCircuitBreakerAdminStats,
	updateCircuitBreakerAdminConfig,
} from "../../circuit-breaker/admin-compat.js";

export function registerCircuitBreakerRoutes(app: Hono): void {
	app.get("/v1/circuit-breaker/config", (c) => {
		try {
			return c.json(getCircuitBreakerAdminConfig());
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
	});

	app.put("/v1/circuit-breaker/config", async (c) => {
		try {
			const body = await c.req.json();

			const update: Partial<LegacyCircuitBreakerConfigView> = {};
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

			return c.json({
				updated: true,
				config: updateCircuitBreakerAdminConfig(update),
			});
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
	});

	app.get("/v1/circuit-breaker/stats", (c) => {
		try {
			const config = getCircuitBreakerAdminConfig();
			return c.json({
				enabled: config.enabled,
				breakers: getCircuitBreakerAdminStats(),
			});
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
	});
}
