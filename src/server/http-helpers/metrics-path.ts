const NORMALIZED_METRICS_PATH_PATTERNS: Array<[RegExp, string]> = [
	[/^\/v1\/approvals\/[^/]+\/approve$/, '/v1/approvals/:id/approve'],
	[/^\/v1\/approvals\/[^/]+\/deny$/, '/v1/approvals/:id/deny'],
	[/^\/v1\/credentials\/[^/]+$/, '/v1/credentials/:id'],
	[/^\/v1\/files\/[^/]+$/, '/v1/files/:id'],
	[/^\/v1\/groups\/[^/]+$/, '/v1/groups/:id'],
	[/^\/v1\/admin\/profiles\/[^/]+$/, '/v1/admin/profiles/:project'],
	[/^\/v1\/admin\/keys\/[^/]+$/, '/v1/admin/keys/:id'],
	[/^\/v1\/admin\/reset-circuit-breaker\/[^/]+$/, '/v1/admin/reset-circuit-breaker/:provider'],
];

const STABLE_METRICS_PATHS = new Set([
	'/',
	'/auth/github',
	'/auth/github/callback',
	'/health',
	'/metrics',
	'/v1/admin/auth-config',
	'/v1/admin/catalog/refresh',
	'/v1/admin/discover',
	'/v1/admin/flush-usage',
	'/v1/admin/health',
	'/v1/admin/me',
	'/v1/admin/model-router/stats',
	'/v1/admin/models/sync',
	'/v1/admin/models/sync/history',
	'/v1/admin/models/sync/status',
	'/v1/admin/overview',
	'/v1/admin/prices/sync',
	'/v1/admin/prices/sync/history',
	'/v1/admin/prices/sync/status',
	'/v1/admin/profiles',
	'/v1/admin/providers',
	'/v1/admin/security-profile',
	'/v1/admin/sessions',
	'/v1/analytics',
	'/v1/approvals',
	'/v1/balancer/strategies',
	'/v1/chat/completions',
	'/v1/circuit-breaker/config',
	'/v1/circuit-breaker/stats',
	'/v1/compare',
	'/v1/compare/history',
	'/v1/compression/stats',
	'/v1/cost/estimate',
	'/v1/cost/models',
	'/v1/credentials',
	'/v1/files',
	'/v1/generate',
	'/v1/groups',
	'/v1/latency',
	'/v1/local/models',
	'/v1/logs',
	'/v1/messages',
	'/v1/models',
	'/v1/providers',
	'/v1/tools/catalog',
	'/v1/tools/search',
]);

const UNKNOWN_METRICS_PATH = 'unknown';

export function normalizeMetricsPath(path: string): string {
	for (const [pattern, replacement] of NORMALIZED_METRICS_PATH_PATTERNS) {
		if (pattern.test(path)) {
			return replacement;
		}
	}

	return STABLE_METRICS_PATHS.has(path) ? path : UNKNOWN_METRICS_PATH;
}

export { NORMALIZED_METRICS_PATH_PATTERNS };
