import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Hono } from "hono";

import { MIN_AUTH_TOKEN_LENGTH } from "../../src/core/constants.js";
import type { GatewayConfig } from "../../src/core/types.js";
import { startHttpListener } from "../../src/server/http-listener.js";
import { createClientIpResolver } from "../../src/server/http-helpers/client-ip.js";
import { createCorsPolicy } from "../../src/server/http-helpers/cors-policy.js";

const originalBindHost = process.env["LLM_GATEWAY_BIND_HOST"];
const validToken = "t".repeat(MIN_AUTH_TOKEN_LENGTH);

afterEach(() => {
	if (originalBindHost === undefined) {
		delete process.env["LLM_GATEWAY_BIND_HOST"];
		return;
	}
	process.env["LLM_GATEWAY_BIND_HOST"] = originalBindHost;
});

function config(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
	return {
		masterKey: Buffer.alloc(32),
		dbPath: "/tmp/auth-bind-cors-test.sqlite",
		httpPort: 3456,
		...overrides,
	};
}

function createCorsApp(origins: readonly string[]) {
	const app = new Hono();
	let downstreamCalls = 0;
	app.use("*", createCorsPolicy(origins));
	app.use("*", async (_c, next) => {
		downstreamCalls += 1;
		await next();
	});
	app.all("/resource", (c) => c.json({ downstream: true }));
	return { app, downstreamCalls: () => downstreamCalls };
}

describe("AUTH-BIND-CORS", () => {
	it("allows default and explicit loopback binds without opening a real listener", () => {
		for (const host of [undefined, "localhost", "127.0.0.1", "127.42.0.1", "::1", "::ffff:127.0.0.1"]) {
			if (host === undefined) delete process.env["LLM_GATEWAY_BIND_HOST"];
			else process.env["LLM_GATEWAY_BIND_HOST"] = host;
			let calls = 0;
			const server = startHttpListener({
				config: config(),
				fetch: () => new Response("ok"),
				serve: (options) => {
					calls += 1;
					assert.equal(options.hostname, host ?? "127.0.0.1");
					return { options };
				},
			});
			assert.equal(calls, 1);
			assert.equal(server.options.port, 3456);
		}
	});

	it("refuses public, blank, weak-token, and admin-only binds before serve", () => {
		const blocked: ReadonlyArray<readonly [string, GatewayConfig]> = [
			["", config()],
			["0.0.0.0", config()],
			["192.168.1.10", config({ authToken: "short" })],
			["::", config({ adminAuth: { staticToken: validToken } })],
		];
		for (const [host, runtimeConfig] of blocked) {
			process.env["LLM_GATEWAY_BIND_HOST"] = host;
			let calls = 0;
			assert.throws(() => startHttpListener({
				config: runtimeConfig,
				fetch: () => new Response("ok"),
				serve: () => {
					calls += 1;
					return { started: true };
				},
			}));
			assert.equal(calls, 0);
		}
	});

	it("allows a non-loopback bind only with a valid gateway auth token", () => {
		process.env["LLM_GATEWAY_BIND_HOST"] = "0.0.0.0";
		let calls = 0;
		startHttpListener({
			config: config({ authToken: validToken }),
			fetch: () => new Response("ok"),
			serve: (options) => {
				calls += 1;
				assert.equal(options.hostname, "0.0.0.0");
				return { started: true };
			},
		});
		assert.equal(calls, 1);
	});

	it("returns exact CORS preflight headers and blocks invalid origins before downstream", async () => {
		const { app, downstreamCalls } = createCorsApp(["https://app.example.com"]);
		const allowed = await app.request("http://gateway.test/resource", {
			method: "OPTIONS",
			headers: {
				Origin: "https://app.example.com",
				"Access-Control-Request-Method": "PATCH",
				"Access-Control-Request-Headers": "X-CSRF-Token",
			},
		});
		assert.equal(allowed.status, 204);
		assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.example.com");
		assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
		assert.match(allowed.headers.get("access-control-allow-methods") ?? "", /PATCH/);
		assert.match(allowed.headers.get("access-control-allow-headers") ?? "", /X-CSRF-Token/i);
		assert.equal(allowed.headers.get("access-control-expose-headers"), "Content-Length");
		assert.equal(allowed.headers.get("access-control-max-age"), "86400");
		assert.equal(downstreamCalls(), 0);

		for (const origin of [undefined, "null", "https://sibling.example.com", "https://app.example.com, https://sibling.example.com"]) {
			const response = await app.request("http://gateway.test/resource", {
				method: "OPTIONS",
				headers: origin === undefined ? undefined : { Origin: origin },
			});
			assert.equal(response.status, 403);
			assert.deepEqual(await response.json(), { error: "The request origin is not allowed.", code: "CSRF_ORIGIN_INVALID" });
		}
		assert.equal(downstreamCalls(), 0);
	});

	it("adds CORS credentials only for ordinary requests from an allowed origin", async () => {
		const { app, downstreamCalls } = createCorsApp(["https://app.example.com"]);
		const allowed = await app.request("http://gateway.test/resource", { headers: { Origin: "https://app.example.com" } });
		assert.equal(allowed.status, 200);
		assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.example.com");
		assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
		const invalid = await app.request("http://gateway.test/resource", { headers: { Origin: "https://sibling.example.com" } });
		const missing = await app.request("http://gateway.test/resource");
		for (const response of [invalid, missing]) {
			assert.equal(response.status, 200);
			assert.equal(response.headers.has("access-control-allow-origin"), false);
			assert.equal(response.headers.has("access-control-allow-credentials"), false);
		}
		assert.equal(downstreamCalls(), 3);
	});

	it("resolves client identity only through trusted peers and a valid right-to-left XFF chain", async () => {
		const app = new Hono();
		const fromPeer = (address: string | undefined) => createClientIpResolver(
			new Set(["10.0.0.1", "10.0.0.2"]),
			() => ({ remote: { address } }),
		);
		app.get("/untrusted", (c) => c.text(fromPeer("198.51.100.9")(c)));
		app.get("/trusted", (c) => c.text(fromPeer("10.0.0.1")(c)));
		app.get("/missing", (c) => c.text(fromPeer(undefined)(c)));

		assert.equal(await (await app.request("http://gateway.test/untrusted", { headers: { "x-forwarded-for": "203.0.113.8", "x-real-ip": "spoofed" } })).text(), "198.51.100.9");
		assert.equal(await (await app.request("http://gateway.test/trusted", { headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.2" } })).text(), "198.51.100.7");
		assert.equal(await (await app.request("http://gateway.test/trusted", { headers: { "x-forwarded-for": "not-an-ip" } })).text(), "10.0.0.1");
		assert.equal(await (await app.request("http://gateway.test/missing", { headers: { "x-forwarded-for": "198.51.100.7" } })).text(), "unknown");
	});
});
