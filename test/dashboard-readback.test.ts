import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiClient } from "../dashboard/src/api/client.js";

describe("dashboard protected readback client", () => {
	it("uses the v2 safe usage endpoints", async () => {
		const originalFetch = globalThis.fetch;
		const paths: string[] = [];
		globalThis.fetch = async (input) => {
			paths.push(String(input));
			return new Response(JSON.stringify({ records: [], breakdown: [] }), { status: 200 });
		};

		try {
			const client = new ApiClient("dashboard-token");
			await client.getUsageSummary();
			await client.getUsageRecords();
			assert.deepEqual(paths, ["/v2/usage/summary", "/v2/usage"]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
