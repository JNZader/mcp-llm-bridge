import type { serve as honoServe } from "@hono/node-server";

import { MIN_AUTH_TOKEN_LENGTH } from "../core/constants.js";
import { getHttpBindHost } from "../core/http-runtime-config.js";
import type { GatewayConfig } from "../core/types.js";

type HonoServeOptions = Parameters<typeof honoServe>[0];
type FetchCallback = HonoServeOptions["fetch"];

export interface HttpListenerOptions {
	fetch: FetchCallback;
	port: number;
	hostname: string;
}

export type HttpServe<Server> = (
	options: HttpListenerOptions,
	onListening?: (info: { port: number }) => void,
) => Server;

export interface StartHttpListenerInput<Server> {
	config: GatewayConfig;
	fetch: FetchCallback;
	serve: HttpServe<Server>;
	onListening?: (info: { port: number }) => void;
}

function isLoopbackIpv4(value: string): boolean {
	const parts = value.split(".");
	const [firstPart] = parts;
	return parts.length === 4 && firstPart !== undefined && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255) && Number(firstPart) === 127;
}

function isMappedLoopback(value: string): boolean {
	const mapped = value.toLowerCase().match(/^::ffff:(.+)$/);
	if (!mapped) {
		return false;
	}
	const mappedAddress = mapped[1];
	if (mappedAddress === undefined) {
		return false;
	}

	if (isLoopbackIpv4(mappedAddress)) {
		return true;
	}

	const parts = mappedAddress.split(":");
	const [highPart, lowPart] = parts;
	if (
		parts.length !== 2 ||
		highPart === undefined ||
		lowPart === undefined ||
		!parts.every((part) => /^[0-9a-f]{1,4}$/i.test(part))
	) {
		return false;
	}
	const ipv4 = (Number.parseInt(highPart, 16) << 16) | Number.parseInt(lowPart, 16);
	return (ipv4 >>> 24) === 127;
}

export function isLoopbackBindHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	return host === "localhost" || host === "::1" || isLoopbackIpv4(host) || isMappedLoopback(host);
}

function hasGatewayAuthToken(config: GatewayConfig): boolean {
	return (config.authToken?.trim().length ?? 0) >= MIN_AUTH_TOKEN_LENGTH;
}

export function assertSecureHttpBind(config: GatewayConfig, hostname: string): void {
	if (!isLoopbackBindHost(hostname) && !hasGatewayAuthToken(config)) {
		throw new Error("Non-loopback HTTP binds require a configured LLM_GATEWAY_AUTH_TOKEN.");
	}
}

export function startHttpListener<Server>(input: StartHttpListenerInput<Server>): Server {
	const hostname = getHttpBindHost();
	assertSecureHttpBind(input.config, hostname);
	return input.serve({ fetch: input.fetch, port: input.config.httpPort, hostname }, input.onListening);
}
