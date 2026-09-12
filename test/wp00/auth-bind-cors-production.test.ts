import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { MIN_AUTH_TOKEN_LENGTH } from "../../src/core/constants.js";
import type { Router } from "../../src/core/router.js";
import type { GatewayConfig } from "../../src/core/types.js";
import { createHttpApp } from "../../src/server/http-app.js";
import type { Vault } from "../../src/vault/vault.js";

const DEFAULT_ORIGIN = "https://gateway.javierzader.com";
const ENVIRONMENT_KEYS = [
	"ENABLE_MULTI_TENANT",
	"LLM_GATEWAY_CORS_ORIGINS",
	"TRUSTED_PROXY_IPS",
] as const;

type EnvironmentKey = (typeof ENVIRONMENT_KEYS)[number];
type FakeName = "router" | "vault";

interface FakeCalls {
	router: number;
	vault: number;
}

const originalEnvironment = new Map<EnvironmentKey, string | undefined>();

beforeEach(() => {
	for (const key of ENVIRONMENT_KEYS) {
		originalEnvironment.set(key, process.env[key]);
	}
	process.env["ENABLE_MULTI_TENANT"] = "false";
	delete process.env["LLM_GATEWAY_CORS_ORIGINS"];
	delete process.env["TRUSTED_PROXY_IPS"];
});

afterEach(() => {
	for (const key of ENVIRONMENT_KEYS) {
		const value = originalEnvironment.get(key);
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
});

function createThrowOnUseFake<T>(name: FakeName, calls: FakeCalls): T {
	return new Proxy({}, {
		get(_target, property) {
			calls[name] += 1;
			throw new Error(`${name}.${String(property)} must not be used by this request.`);
		},
	}) as T;
}

function createApp(calls: FakeCalls) {
	const config: GatewayConfig = {
		masterKey: Buffer.alloc(32),
		dbPath: "not-used-by-http-app-test",
		httpPort: 0,
		authToken: "t".repeat(MIN_AUTH_TOKEN_LENGTH),
	};

	return createHttpApp({
		router: createThrowOnUseFake<Router>("router", calls),
		vault: createThrowOnUseFake<Vault>("vault", calls),
		config,
		serverStartTime: 0,
	});
}

function assertUnusedFakes(calls: FakeCalls): void {
	assert.deepEqual(calls, { router: 0, vault: 0 });
}

describe("AUTH-BIND-CORS production HTTP application wiring", () => {
	it("enforces preflight origin policy before authentication or route handlers", async () => {
		const calls: FakeCalls = { router: 0, vault: 0 };
		const app = createApp(calls);

		const allowed = await app.request("http://gateway.test/v1/models", {
			method: "OPTIONS",
			headers: {
				Origin: DEFAULT_ORIGIN,
				"Access-Control-Request-Method": "PATCH",
				"Access-Control-Request-Headers": "Authorization,X-CSRF-Token",
			},
		});

		assert.equal(allowed.status, 204);
		assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), DEFAULT_ORIGIN);
		assert.equal(allowed.headers.get("Access-Control-Allow-Methods"), "GET,POST,PUT,PATCH,DELETE,OPTIONS");
		assert.equal(allowed.headers.get("Access-Control-Allow-Headers"), "Content-Type,Authorization,X-Project,x-api-key,X-CSRF-Token");
		assert.equal(allowed.headers.get("Access-Control-Allow-Credentials"), "true");

		for (const origin of [undefined, "https://not-allowed.example.com"] as const) {
			const headers = new Headers({
				"Access-Control-Request-Method": "PATCH",
				"Access-Control-Request-Headers": "Authorization,X-CSRF-Token",
			});
			if (origin !== undefined) {
				headers.set("Origin", origin);
			}

			const response = await app.request("http://gateway.test/v1/models", {
				method: "OPTIONS",
				headers,
			});
			assert.equal(response.status, 403);
			assert.deepEqual(await response.json(), {
				error: "The request origin is not allowed.",
				code: "CSRF_ORIGIN_INVALID",
			});
		}

		assertUnusedFakes(calls);
	});

	it("applies CORS to authenticated boundaries without invoking protected handlers", async () => {
		const calls: FakeCalls = { router: 0, vault: 0 };
		const app = createApp(calls);

		const allowedOrigin = await app.request("http://gateway.test/v1/models", {
			headers: { Origin: DEFAULT_ORIGIN },
		});
		assert.equal(allowedOrigin.status, 401);
		assert.equal(allowedOrigin.headers.get("Access-Control-Allow-Origin"), DEFAULT_ORIGIN);
		assert.equal(allowedOrigin.headers.get("Access-Control-Allow-Credentials"), "true");

		const disallowedOrigin = await app.request("http://gateway.test/v1/models", {
			headers: { Origin: "https://not-allowed.example.com" },
		});
		assert.equal(disallowedOrigin.status, 401);
		assert.equal(disallowedOrigin.headers.get("Access-Control-Allow-Origin"), null);
		assert.equal(disallowedOrigin.headers.get("Access-Control-Allow-Credentials"), null);

		assertUnusedFakes(calls);
	});
});
