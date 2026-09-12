import { getConnInfo } from "@hono/node-server/conninfo";
import { isIP } from "node:net";

import type { Context } from "hono";

interface ConnectionInfo {
	remote: { address?: string };
}

export type ConnectionInfoReader = (context: Context) => ConnectionInfo;
export type ClientIpResolver = (context: Context) => string;

const readNodeConnectionInfo: ConnectionInfoReader = getConnInfo;

function getPeerAddress(context: Context, readConnection: ConnectionInfoReader): string {
	try {
		const address = readConnection(context).remote.address;
		return typeof address === "string" && isIP(address) !== 0 ? address : "unknown";
	} catch {
		return "unknown";
	}
}

function parseForwardedChain(value: string | undefined): string[] | undefined {
	if (!value) {
		return undefined;
	}
	const hops = value.split(",").map((hop) => hop.trim());
	return hops.length > 0 && hops.every((hop) => isIP(hop) !== 0) ? hops : undefined;
}

export function createClientIpResolver(
	trustedProxyIps: ReadonlySet<string> | undefined,
	readConnection: ConnectionInfoReader = readNodeConnectionInfo,
): ClientIpResolver {
	return (context) => {
		const peerAddress = getPeerAddress(context, readConnection);
		if (peerAddress === "unknown" || !trustedProxyIps?.has(peerAddress)) {
			return peerAddress;
		}

		const chain = parseForwardedChain(context.req.header("x-forwarded-for"));
		if (!chain) {
			return peerAddress;
		}
		for (const hop of [...chain].reverse()) {
			if (!trustedProxyIps.has(hop)) {
				return hop;
			}
		}
		return peerAddress;
	};
}
