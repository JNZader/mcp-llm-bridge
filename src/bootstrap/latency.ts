import { logger } from "../core/logger.js";
import { latencyRoutingEnabled } from "../core/runtime-flags.js";
import type { Router } from "../core/router.js";
import { LatencyMeasurer } from "../latency/index.js";

export function bootstrapLatencyRouting(router: Router): LatencyMeasurer {
	const latencyMeasurer = new LatencyMeasurer();

	if (latencyRoutingEnabled()) {
		router.setLatencyMeasurer(latencyMeasurer);
		logger.info("Latency-based routing enabled");
	}

	return latencyMeasurer;
}
