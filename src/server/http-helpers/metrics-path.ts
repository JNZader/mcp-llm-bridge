const NORMALIZED_METRICS_PATH_PATTERNS: Array<[RegExp, string]> = [
	[/^\/v1\/credentials\/[^/]+$/, '/v1/credentials/:id'],
	[/^\/v1\/files\/[^/]+$/, '/v1/files/:id'],
	[/^\/v1\/groups\/[^/]+$/, '/v1/groups/:id'],
	[/^\/v1\/admin\/profiles\/[^/]+$/, '/v1/admin/profiles/:project'],
	[/^\/v1\/admin\/keys\/[^/]+$/, '/v1/admin/keys/:id'],
	[/^\/v1\/admin\/reset-circuit-breaker\/[^/]+$/, '/v1/admin/reset-circuit-breaker/:provider'],
];

export function normalizeMetricsPath(path: string): string {
	for (const [pattern, replacement] of NORMALIZED_METRICS_PATH_PATTERNS) {
		if (pattern.test(path)) {
			return replacement;
		}
	}

	return path;
}

export { NORMALIZED_METRICS_PATH_PATTERNS };
