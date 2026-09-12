/**
 * Non-sensitive HTTP runtime config readers backed by process.env.
 */

const DEFAULT_CORS_ORIGIN = "https://gateway.javierzader.com";
const DEFAULT_HTTP_BIND_HOST = "127.0.0.1";

function hasOriginOnlySyntax(origin: string): boolean {
	return /^https?:\/\/[^/?#\\]+$/i.test(origin) && !/[\t\n\v\f\r ]/.test(origin);
}

function parseCorsOrigin(value: string): string {
	const origin = value.trim();
	if (!origin || origin === "*" || origin === "null") {
		throw new Error("LLM_GATEWAY_CORS_ORIGINS must contain explicit HTTP(S) origins.");
	}
	if (!hasOriginOnlySyntax(origin)) {
		throw new Error("LLM_GATEWAY_CORS_ORIGINS must contain origin-only HTTP(S) URLs.");
	}

	let parsed: URL;
	try {
		parsed = new URL(origin);
	} catch {
		throw new Error("LLM_GATEWAY_CORS_ORIGINS contains an invalid origin.");
	}

	if (
		(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
		!parsed.hostname ||
		parsed.username ||
		parsed.password ||
		parsed.pathname !== "/" ||
		parsed.search ||
		parsed.hash
	) {
		throw new Error("LLM_GATEWAY_CORS_ORIGINS must contain origin-only HTTP(S) URLs.");
	}

	return parsed.origin;
}

/** Extract explicit HTTP(S) CORS origins from the environment. */
export function getCorsOrigins(): string[] {
	const envOrigins = process.env["LLM_GATEWAY_CORS_ORIGINS"];
	if (envOrigins === undefined) {
		return [DEFAULT_CORS_ORIGIN];
	}
	return envOrigins.split(",").map(parseCorsOrigin);
}

/** Read the HTTP bind host without widening the gateway configuration type. */
export function getHttpBindHost(): string {
	const configuredHost = process.env["LLM_GATEWAY_BIND_HOST"];
	if (configuredHost === undefined) {
		return DEFAULT_HTTP_BIND_HOST;
	}

	const host = configuredHost.trim();
	if (!host) {
		throw new Error("LLM_GATEWAY_BIND_HOST must not be blank when configured.");
	}
	return host;
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
