/**
 * Non-sensitive HTTP runtime config readers backed by process.env.
 */

/**
 * Extract allowed CORS origins from environment variable.
 *
 * Format: comma-separated list of origins, or '*' for allow all.
 * Example: 'https://example.com,https://app.example.com'
 */
export function getCorsOrigins(): string | string[] {
	const envOrigins = process.env["LLM_GATEWAY_CORS_ORIGINS"];
	if (!envOrigins) {
		// Default: allow only Cloudflare hosted dashboard
		return ["https://gateway.javierzader.com"];
	}
	if (envOrigins === "*") {
		// CORS '*' is allowed but we return it as-is
		return "*";
	}
	return envOrigins.split(",").map((origin) => origin.trim());
}

/**
 * Extract trusted proxy IPs from environment variable.
 */
export function getTrustedProxyIps(): Set<string> | undefined {
	const trustedProxies = process.env["TRUSTED_PROXY_IPS"];
	if (!trustedProxies) {
		return undefined;
	}

	return new Set(trustedProxies.split(",").map((ip) => ip.trim()));
}

/**
 * Whether HTTP multi-tenant mode is enabled.
 */
export function isMultiTenantEnabled(): boolean {
	return process.env["ENABLE_MULTI_TENANT"] === "true";
}
