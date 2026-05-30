import { randomBytes } from "node:crypto";
import type { Hono } from "hono";

import {
	isGithubOauthConfigured,
	getGithubAuthUrl,
	exchangeCodeForUser,
	createDashboardJwt,
	isUserAllowed,
} from "../../auth/github-oauth.js";
import { VERSION } from "../../core/constants.js";
import type { Router } from "../../core/router.js";
import type { GatewayConfig } from "../../core/types.js";
import { dashboardHtml } from "../dashboard.js";
import type { Vault } from "../../vault/vault.js";

export interface PublicRouteDeps {
	router: Router;
	vault: Vault;
	config: GatewayConfig;
	serverStartTime: number;
}

function detectAnthropicSubscription(
	vault: Vault,
): "pro" | "max" | "api" | "none" {
	try {
		const apiKey = vault.getDecrypted("anthropic", "default");

		if (apiKey.startsWith("sk-ant-")) {
			return "api";
		}

		return "api";
	} catch {
		return "none";
	}
}

export function registerPublicRoutes(app: Hono, deps: PublicRouteDeps): void {
	const { router, vault, config, serverStartTime } = deps;
	const dashboardHtmlCache = dashboardHtml();

	app.get("/auth/github", (c) => {
		if (!isGithubOauthConfigured()) {
			return c.json({ error: "GitHub OAuth not configured" }, 503);
		}
		const state = randomBytes(16).toString("hex");
		const origin = new URL(c.req.url).origin;
		const redirectUri = `${origin}/auth/github/callback`;
		c.header("Set-Cookie", `gh_oauth_state=${state}; HttpOnly; Path=/; Max-Age=300; SameSite=Lax`);
		return c.redirect(getGithubAuthUrl(state, redirectUri), 302);
	});

	app.get("/auth/github/callback", async (c) => {
		const code = c.req.query("code");
		const state = c.req.query("state");
		const cookieHeader = c.req.header("Cookie") ?? "";
		const storedState = cookieHeader
			.split(";")
			.map((p) => p.trim())
			.find((p) => p.startsWith("gh_oauth_state="))
			?.split("=")[1];

		c.header("Set-Cookie", "gh_oauth_state=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");

		if (!code || !state || state !== storedState) {
			return c.redirect(
				"/#/oauth/callback?error=" + encodeURIComponent("Invalid OAuth state. Please try again."),
			);
		}

		try {
			const user = await exchangeCodeForUser(code);
			if (!isUserAllowed(user.login)) {
				return c.redirect(
					"/#/oauth/callback?error=" +
						encodeURIComponent(`User "${user.login}" is not allowed. Contact the admin.`),
				);
			}
			const token = createDashboardJwt(user);
			return c.redirect(`/#/oauth/callback?token=${token}`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "GitHub OAuth failed";
			return c.redirect("/#/oauth/callback?error=" + encodeURIComponent(msg));
		}
	});

	app.get("/v1/admin/auth-config", (c) => {
		return c.json({ githubOauth: isGithubOauthConfigured() });
	});

	app.get("/", (c) => c.html(dashboardHtmlCache));

	app.get("/health", async (c) => {
		const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);
		const providers = await router.getProviderStatuses();
		const availableCount = providers.filter((p) => p.available).length;
		const authMode = config.authToken ? "bearer" : "disabled";
		const subscription = detectAnthropicSubscription(vault);

		return c.json({
			status: "ok",
			version: VERSION,
			timestamp: new Date().toISOString(),
			uptime: uptimeSeconds,
			auth: {
				enabled: !!config.authToken,
				mode: authMode,
			},
			providers: {
				total: providers.length,
				available: availableCount,
			},
			subscription: {
				anthropic: subscription,
			},
			mode: "proxy",
		});
	});
}
