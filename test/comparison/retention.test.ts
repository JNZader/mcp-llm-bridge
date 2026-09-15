import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { ComparisonStore } from "../../src/comparison/persistence.js";
import { ProfileEnforcer } from "../../src/security/enforcer.js";

function response(id: string, createdAt: string) {
	return {
		id,
		prompt: "retention-canary",
		results: [],
		summary: { totalCost: 0, wallClockMs: 0 },
		createdAt,
	};
}

describe("comparison retention", () => {
	it("deletes expired content and reports content-free absence evidence", () => {
		const audit: unknown[] = [];
		const capability = new ProfileEnforcer("local-dev").issueComparisonCapability("*", (event) => audit.push(event))!;
		const db = new Database(":memory:");
		const store = new ComparisonStore(db, capability);
		const expired = randomUUID();
		const current = randomUUID();
		store.save(response(expired, "2026-01-01T00:00:00.000Z"));
		store.save(response(current, "2026-02-01T00:00:00.000Z"));
		const evidence = store.purgeExpired(new Date("2026-02-01T00:00:00.000Z"));
		assert.equal(evidence.status, "success");
		assert.deepEqual(evidence.deletedIds, [expired]);
		assert.equal(store.getById(expired), null);
		assert.ok(store.getById(current));
		assert.equal(JSON.stringify(audit).includes("retention-canary"), false);
		assert.equal(store.deleteById(current).status, "success");
		assert.equal(store.getById(current), null);
	});

	it("does not report success when deletion verification is indeterminate", () => {
		const capability = new ProfileEnforcer("local-dev").issueComparisonCapability("*")!;
		const store = new ComparisonStore(new Database(":memory:"), capability);
		assert.equal(store.purgeExpired(new Date("invalid")).status, "INDETERMINATE");
	});
});
