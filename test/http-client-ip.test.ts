import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveClientIp } from "../src/server/http-helpers/client-ip.js";

describe("resolveClientIp", () => {
	it("uses the socket peer and ignores spoofed headers without trusted proxies", () => {
		assert.equal(
			resolveClientIp({
				peerAddress: "203.0.113.10",
				xRealIp: "1.2.3.4",
				xForwardedFor: "8.8.8.8, 10.0.0.1",
			}),
			"203.0.113.10",
		);
	});

	it("returns unknown when the socket address is missing", () => {
		assert.equal(resolveClientIp({ xRealIp: "1.2.3.4" }), "unknown");
	});

	it("strips IPv4-mapped IPv6 prefixes", () => {
		assert.equal(
			resolveClientIp({ peerAddress: "::ffff:127.0.0.1" }),
			"127.0.0.1",
		);
	});

	it("honors X-Forwarded-For only when the peer is a trusted proxy", () => {
		const trustedProxyIps = new Set(["10.0.0.1"]);
		assert.equal(
			resolveClientIp({
				peerAddress: "10.0.0.1",
				trustedProxyIps,
				xForwardedFor: " 198.51.100.20 , 10.0.0.1",
			}),
			"198.51.100.20",
		);
		assert.equal(
			resolveClientIp({
				peerAddress: "203.0.113.10",
				trustedProxyIps,
				xForwardedFor: "198.51.100.20",
			}),
			"203.0.113.10",
		);
	});

	it("falls back to X-Real-IP when a trusted proxy omits X-Forwarded-For", () => {
		assert.equal(
			resolveClientIp({
				peerAddress: "10.0.0.1",
				trustedProxyIps: new Set(["10.0.0.1"]),
				xRealIp: "198.51.100.20",
			}),
			"198.51.100.20",
		);
	});
});
