/**
 * Client IP for rate limiting. Socket peer is authoritative unless the peer
 * is an explicitly trusted proxy.
 */

export interface ResolveClientIpInput {
	peerAddress?: string | null;
	trustedProxyIps?: Set<string>;
	xForwardedFor?: string | null;
	xRealIp?: string | null;
}

export function normalizeIp(raw?: string | null): string | undefined {
	if (!raw) {
		return undefined;
	}
	const trimmed = raw.trim();
	if (!trimmed) {
		return undefined;
	}
	return trimmed.replace(/^::ffff:/i, "");
}

export function resolveClientIp(input: ResolveClientIpInput): string {
	const peer = normalizeIp(input.peerAddress) ?? "unknown";
	if (!input.trustedProxyIps?.has(peer)) {
		return peer;
	}

	const forwarded = normalizeIp(input.xForwardedFor?.split(",")[0]);
	if (forwarded) {
		return forwarded;
	}

	return normalizeIp(input.xRealIp) ?? peer;
}
