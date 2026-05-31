import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
	getMaxComparisonCostUsdFromEnv,
	parseMaxComparisonCostUsd,
} from "../../src/core/comparison-config.js";

const ENV_KEY = "MAX_COMPARISON_COST_USD";
const ORIGINAL_ENV_VALUE = process.env[ENV_KEY];

afterEach(() => {
	if (ORIGINAL_ENV_VALUE === undefined) {
		delete process.env[ENV_KEY];
		return;
	}

	process.env[ENV_KEY] = ORIGINAL_ENV_VALUE;
});

describe("comparison config helpers", () => {
	it("keeps valid positive values and defaults invalid ones to 1.0", () => {
		assert.equal(parseMaxComparisonCostUsd(2.5), 2.5);
		assert.equal(parseMaxComparisonCostUsd("3.75"), 3.75);
		assert.equal(parseMaxComparisonCostUsd(undefined), 1.0);
		assert.equal(parseMaxComparisonCostUsd("0"), 1.0);
		assert.equal(parseMaxComparisonCostUsd("-2"), 1.0);
		assert.equal(parseMaxComparisonCostUsd("wat"), 1.0);
	});

	it("reads env through the same parsing/defaulting rule", () => {
		process.env[ENV_KEY] = "4.2";
		assert.equal(getMaxComparisonCostUsdFromEnv(), 4.2);

		process.env[ENV_KEY] = "0";
		assert.equal(getMaxComparisonCostUsdFromEnv(), 1.0);
	});
});
