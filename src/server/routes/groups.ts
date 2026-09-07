import type { Hono } from "hono";
import { safeError } from "../../core/safe-error.js";

import type { GroupStore } from "../../core/groups.js";
import { CreateGroupSchema, UpdateGroupSchema } from "../../core/groups.js";

export interface GroupsRouteDeps {
	groupStore?: GroupStore;
}

function validationError(field: unknown) {
	const allowed = field === "name" || field === "modelPattern" || field === "members"
		|| field === "strategy" || field === "weights" || field === "stickyTTL";
	return {
		error: safeError("INVALID_REQUEST").message,
		code: "VALIDATION_ERROR",
		field: allowed ? field : "",
	};
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
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
	});

	app.post("/v1/groups", async (c) => {
		try {
			const body = await c.req.json();

			const validated = CreateGroupSchema.safeParse(body);
			if (!validated.success) {
				return c.json(validationError(validated.error.issues[0]?.path[0]), 400);
			}

			const group = groupStore.create(validated.data);
			return c.json(group, 201);
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
	});

	app.put("/v1/groups/:id", async (c) => {
		try {
			const id = c.req.param("id");
			const body = await c.req.json();

			const validated = UpdateGroupSchema.safeParse(body);
			if (!validated.success) {
				return c.json(validationError(validated.error.issues[0]?.path[0]), 400);
			}

			const updated = groupStore.update(id, validated.data);
			if (!updated) {
				return c.json(
					{ error: "The requested resource was not found.", code: "NOT_FOUND" },
					404,
				);
			}

			return c.json(updated);
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
	});

	app.delete("/v1/groups/:id", (c) => {
		try {
			const id = c.req.param("id");
			const deleted = groupStore.delete(id);
			if (!deleted) {
				return c.json(
					{ error: "The requested resource was not found.", code: "NOT_FOUND" },
					404,
				);
			}

			return c.json({ ok: true });
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
	});
}
