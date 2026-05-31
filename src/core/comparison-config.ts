const DEFAULT_MAX_COMPARISON_COST_USD = 1.0;

export function parseMaxComparisonCostUsd(value: number | string | undefined): number {
	const parsed =
		typeof value === "number"
			? value
			: value === undefined
				? Number.NaN
				: Number.parseFloat(value);

	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: DEFAULT_MAX_COMPARISON_COST_USD;
}

export function getMaxComparisonCostUsdFromEnv(env = process.env): number {
	return parseMaxComparisonCostUsd(env["MAX_COMPARISON_COST_USD"]);
}
