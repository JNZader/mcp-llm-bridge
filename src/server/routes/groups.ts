import type { Hono } from "hono";

import type { GroupStore } from "../../core/groups.js";
import { CreateGroupSchema, UpdateGroupSchema } from "../../core/groups.js";

export interface GroupsRouteDeps {
	groupStore?: GroupStore;
}

interface ValidationIssueLike {
	message: string;
	path: string[];
}

function getValidationIssue(error: unknown): ValidationIssueLike | null {
	if (!(error && typeof error === "object" && "issues" in error)) {
		return null;
	}

	const issues = (error as { issues: ValidationIssueLike[] }).issues;
	return issues[0] ?? null;
}

export function registerGroupRoutes(app: Hono, deps: GroupsRouteDeps): void {
	const { groupStore } = deps;

	if (!groupStore) {
		return;
	}

	app.get("/v1/groups", (c) => {
		try {
			const groups = groupStore.list();
			return c.json({ groups });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.post("/v1/groups", async (c) => {
		try {
			const body = await c.req.json();

			let validated: ReturnType<typeof CreateGroupSchema.parse>;
			try {
				validated = CreateGroupSchema.parse(body);
			} catch (error) {
				const issue = getValidationIssue(error);
				if (issue) {
					return c.json(
						{
							error: issue.message,
							code: "VALIDATION_ERROR",
							field: issue.path.join("."),
						},
						400,
					);
				}
				throw error;
			}

			const group = groupStore.create(validated);
			return c.json(group, 201);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.put("/v1/groups/:id", async (c) => {
		try {
			const id = c.req.param("id");
			const body = await c.req.json();

			let validated: ReturnType<typeof UpdateGroupSchema.parse>;
			try {
				validated = UpdateGroupSchema.parse(body);
			} catch (error) {
				const issue = getValidationIssue(error);
				if (issue) {
					return c.json(
						{
							error: issue.message,
							code: "VALIDATION_ERROR",
							field: issue.path.join("."),
						},
						400,
					);
				}
				throw error;
			}

			const updated = groupStore.update(id, validated);
			if (!updated) {
				return c.json(
					{ error: `Group not found: ${id}`, code: "NOT_FOUND" },
					404,
				);
			}

			return c.json(updated);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.delete("/v1/groups/:id", (c) => {
		try {
			const id = c.req.param("id");
			const deleted = groupStore.delete(id);
			if (!deleted) {
				return c.json(
					{ error: `Group not found: ${id}`, code: "NOT_FOUND" },
					404,
				);
			}

			return c.json({ ok: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});
}
