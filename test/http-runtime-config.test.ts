import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
	getHttpBindHost,
	getCorsOrigins,
	getTrustedProxyIps,
	isMultiTenantEnabled,
} from "../src/core/http-runtime-config.js";

const originalCorsOrigins = process.env["LLM_GATEWAY_CORS_ORIGINS"];
const originalTrustedProxyIps = process.env["TRUSTED_PROXY_IPS"];
const originalEnableMultiTenant = process.env["ENABLE_MULTI_TENANT"];
const originalBindHost = process.env["LLM_GATEWAY_BIND_HOST"];

afterEach(() => {
	restoreEnv("LLM_GATEWAY_CORS_ORIGINS", originalCorsOrigins);
	restoreEnv("TRUSTED_PROXY_IPS", originalTrustedProxyIps);
	restoreEnv("ENABLE_MULTI_TENANT", originalEnableMultiTenant);
	restoreEnv("LLM_GATEWAY_BIND_HOST", originalBindHost);
});

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
		return;
	}

	process.env[name] = value;
}

describe("http runtime config", () => {
	it("returns the default dashboard CORS origin when unset", () => {
		delete process.env["LLM_GATEWAY_CORS_ORIGINS"];

		assert.deepEqual(getCorsOrigins(), ["https://gateway.javierzader.com"]);
	});

	it("rejects wildcard and malformed CORS origins", () => {
		process.env["LLM_GATEWAY_CORS_ORIGINS"] = "*";
		assert.throws(getCorsOrigins);

		for (const origin of ["", "https://app.example.com,", "null", "https://app.example.com/path", "https://app.example.com?query=1", "ftp://app.example.com"]) {
			process.env["LLM_GATEWAY_CORS_ORIGINS"] = origin;
			assert.throws(getCorsOrigins);
		}
	});

	it("rejects raw CORS syntax that URL canonicalization would otherwise hide", () => {
		for (const origin of [
			"https://app.example.com/foo/..",
			"https://app.example.com?",
			"https://app.example.com#",
			"https://app.example.com\\foo\\..",
			"https://app.example.com /hidden",
		]) {
			process.env["LLM_GATEWAY_CORS_ORIGINS"] = origin;
			assert.throws(getCorsOrigins);
		}

		process.env["LLM_GATEWAY_CORS_ORIGINS"] = "https://app.example.com:443";
		assert.deepEqual(getCorsOrigins(), ["https://app.example.com"]);
	});

	it("trims configured CORS origins", () => {
		process.env["LLM_GATEWAY_CORS_ORIGINS"] =
			" https://app.example.com, https://admin.example.com ";

		assert.deepEqual(getCorsOrigins(), [
			"https://app.example.com",
			"https://admin.example.com",
		]);
	});

	it("defaults the bind host and rejects explicit blank values", () => {
		delete process.env["LLM_GATEWAY_BIND_HOST"];
		assert.equal(getHttpBindHost(), "127.0.0.1");
		process.env["LLM_GATEWAY_BIND_HOST"] = "  ";
		assert.throws(getHttpBindHost);
		process.env["LLM_GATEWAY_BIND_HOST"] = " 127.0.0.1 ";
		assert.equal(getHttpBindHost(), "127.0.0.1");
	});

	it("returns undefined trusted proxies when unset", () => {
		delete process.env["TRUSTED_PROXY_IPS"];

		assert.equal(getTrustedProxyIps(), undefined);
	});

	it("returns trusted proxy IPs as a trimmed set", () => {
		process.env["TRUSTED_PROXY_IPS"] = " 10.0.0.1, 10.0.0.2 ";

		assert.deepEqual(getTrustedProxyIps(), new Set(["10.0.0.1", "10.0.0.2"]));
	});

	it("enables multi-tenant mode only for the literal true string", () => {
		process.env["ENABLE_MULTI_TENANT"] = "true";
		assert.equal(isMultiTenantEnabled(), true);

		process.env["ENABLE_MULTI_TENANT"] = "false";
		assert.equal(isMultiTenantEnabled(), false);

		delete process.env["ENABLE_MULTI_TENANT"];
		assert.equal(isMultiTenantEnabled(), false);
	});
});
