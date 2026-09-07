import type { Hono } from "hono";

import type { ApprovalStore } from "../../approval/index.js";
import { safeError } from "../../core/safe-error.js";

export interface ApprovalRouteDeps {
	approvalStore?: ApprovalStore;
}

export function registerApprovalRoutes(app: Hono, deps: ApprovalRouteDeps): void {
	const { approvalStore } = deps;

	if (!approvalStore) {
		return;
	}

	app.get("/v1/approvals", (c) => {
		try {
			const pending = approvalStore.getPending();
			return c.json({ requests: pending, count: pending.length });
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
	});

	app.post("/v1/approvals/:id/approve", (c) => {
		try {
			const id = c.req.param("id");
			const resolvedBy = c.req.header("X-User-Id") ?? "admin";
			const updated = approvalStore.approve(id, resolvedBy);
			if (!updated) {
				return c.json(
					{
						error: "Approval request not found or already resolved",
						code: "NOT_FOUND",
					},
					404,
				);
			}

			return c.json(updated);
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
	});

	app.post("/v1/approvals/:id/deny", (c) => {
		try {
			const id = c.req.param("id");
			const resolvedBy = c.req.header("X-User-Id") ?? "admin";
			const updated = approvalStore.deny(id, resolvedBy);
			if (!updated) {
				return c.json(
					{
						error: "Approval request not found or already resolved",
						code: "NOT_FOUND",
					},
					404,
				);
			}

			return c.json(updated);
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
	});
}
