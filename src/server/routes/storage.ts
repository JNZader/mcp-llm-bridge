import type { Context, Hono } from "hono";

import { VALID_PROVIDERS } from "../../core/constants.js";
import {
	validateCredentialStore,
	validateFileStore,
} from "../../core/schemas.js";
import type { Vault } from "../../vault/vault.js";
import {
	getValidationIssue,
	resolveRequestProject,
} from "../http-helpers/request-validation.js";

export interface StorageRouteDeps {
	vault: Vault;
}

function getScopedProject(c: Context): string | undefined {
	return c.req.query("project") ?? c.req.header("X-Project") ?? undefined;
}

function jsonDeleteError(c: Context, message: string): Response {
	if (message.includes("Unauthorized")) {
		return c.json({ error: message, code: "UNAUTHORIZED" }, 403);
	}

	if (message.includes("not found")) {
		return c.json({ error: message, code: "NOT_FOUND" }, 404);
	}

	return c.json({ error: message }, 500);
}

export function registerStorageRoutes(app: Hono, deps: StorageRouteDeps): void {
	const { vault } = deps;

	app.post("/v1/credentials", async (c) => {
		try {
			const body = await c.req.json();

			let validated: ReturnType<typeof validateCredentialStore>;
			try {
				validated = validateCredentialStore(body);
			} catch (error) {
				const issue = getValidationIssue(error);
				if (issue) {
					return c.json(
						{
							error: issue.message,
							code: "VALIDATION_ERROR",
							field: issue.field,
							validProviders: [...VALID_PROVIDERS],
						},
						400,
					);
				}

				throw error;
			}

			const keyName = validated.keyName ?? "default";
			const project = resolveRequestProject(validated.project, c);
			const id = vault.store(
				validated.provider,
				keyName,
				validated.apiKey,
				project,
			);

			return c.json(
				{
					id,
					provider: validated.provider,
					keyName,
					project: project ?? "_global",
				},
				201,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.get("/v1/credentials", (c) => {
		try {
			const credentials = vault.listMasked(getScopedProject(c));
			return c.json({ credentials });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.delete("/v1/credentials/:id", (c) => {
		try {
			const id = Number(c.req.param("id"));

			if (isNaN(id)) {
				return c.json({ error: "id must be a number" }, 400);
			}

			vault.delete(id, getScopedProject(c));
			return c.json({ ok: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return jsonDeleteError(c, message);
		}
	});

	app.post("/v1/files", async (c) => {
		try {
			const body = await c.req.json();

			let validated: ReturnType<typeof validateFileStore>;
			try {
				validated = validateFileStore(body);
			} catch (error) {
				const issue = getValidationIssue(error);
				if (issue) {
					return c.json(
						{
							error: issue.message,
							code: "VALIDATION_ERROR",
							field: issue.field,
						},
						400,
					);
				}

				throw error;
			}

			const project = resolveRequestProject(validated.project, c);
			const id = vault.storeFile(
				validated.provider,
				validated.fileName,
				validated.content,
				project,
			);

			return c.json(
				{
					id,
					provider: validated.provider,
					fileName: validated.fileName,
					project: project ?? "_global",
				},
				201,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.get("/v1/files", (c) => {
		try {
			const files = vault.listFiles(getScopedProject(c));
			return c.json({ files });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.delete("/v1/files/:id", (c) => {
		try {
			const id = Number(c.req.param("id"));

			if (isNaN(id)) {
				return c.json({ error: "id must be a number" }, 400);
			}

			vault.deleteFile(id, getScopedProject(c));
			return c.json({ ok: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return jsonDeleteError(c, message);
		}
	});
}
