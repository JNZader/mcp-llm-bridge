/**
 * Comparison Store — SQLite persistence for comparison results.
 *
 * Follows the same better-sqlite3 patterns as CostTracker and Vault.
 * Stores full comparison results as JSON blobs with indexed project/date.
 */

import type Database from "better-sqlite3";
import { GLOBAL_PROJECT } from "../core/constants.js";
import type { ComparisonCapability } from "../security/enforcer.js";
import type { ComparisonPurgeStatus } from "./schemas.js";
import type { CompareResponse } from "./types.js";

/** Row shape returned from comparison_results table. */
interface ComparisonRow {
	id: string;
	prompt: string;
	system_prompt: string | null;
	models: string;
	results: string;
	summary: string;
	project: string;
	created_at: string;
}

/** Query filters for listing comparisons. */
export interface ComparisonQueryFilters {
	project?: string;
	limit?: number;
	offset?: number;
}

export interface ComparisonPurgeEvidence {
	status: ComparisonPurgeStatus;
	deletedIds: string[];
}

/**
 * ComparisonStore — read/write for the comparison_results table.
 *
 * Requires the table to already exist (created by initializeDb via
 * migration 007 or inline CREATE TABLE).
 */
export class ComparisonStore {
	private readonly insertStmt: Database.Statement;
	private readonly insertContentStmt: Database.Statement;
	private readonly getByIdStmt: Database.Statement;

	constructor(private readonly db: Database.Database, private readonly capability?: ComparisonCapability) {
		// Ensure table exists (idempotent — matches migration 007)
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS comparison_results (
        id TEXT PRIMARY KEY,
         models TEXT NOT NULL,
         project TEXT NOT NULL DEFAULT '${GLOBAL_PROJECT}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_comparison_project ON comparison_results(project);
       CREATE INDEX IF NOT EXISTS idx_comparison_created ON comparison_results(created_at);
       CREATE TABLE IF NOT EXISTS authorized_comparison_results (
         id TEXT PRIMARY KEY REFERENCES comparison_results(id), prompt TEXT NOT NULL,
         system_prompt TEXT, results TEXT NOT NULL, summary TEXT NOT NULL
       );
    `);

		this.insertStmt = this.db.prepare("INSERT INTO comparison_results (id, models, project, created_at) VALUES (@id, @models, @project, @createdAt)");
		this.insertContentStmt = this.db.prepare("INSERT INTO authorized_comparison_results (id, prompt, system_prompt, results, summary) VALUES (@id, @prompt, @systemPrompt, @results, @summary)");

		this.getByIdStmt = this.db.prepare(
			"SELECT c.*, a.prompt, a.system_prompt, a.results, a.summary FROM comparison_results c JOIN authorized_comparison_results a USING(id) WHERE c.id = ?",
		);
	}

	/**
	 * Persist a comparison result.
	 */
	save(
		result: CompareResponse,
		systemPrompt?: string,
		models?: string[],
		project?: string,
		capability = this.capability,
	): void {
		const scopedProject = this.authorize(capability, "persist", project);
		const values = {
			id: result.id,
			prompt: result.prompt,
			systemPrompt: systemPrompt ?? null,
			models: JSON.stringify(models ?? result.results.map((r) => r.model)),
			results: JSON.stringify(result.results),
			summary: JSON.stringify(result.summary),
			project: scopedProject,
			createdAt: result.createdAt,
		};
		this.db.transaction(() => { this.insertStmt.run(values); this.insertContentStmt.run(values); })();
	}

	/**
	 * Retrieve a single comparison by ID.
	 */
	getById(id: string, capability = this.capability): CompareResponse | null {
		const project = this.authorize(capability, "read");
		const row = this.getByIdStmt.get(id) as ComparisonRow | undefined;
		if (!row || (project !== "*" && row.project !== project)) return null;
		return this.mapRow(row);
	}

	/**
	 * List comparisons with optional project filter and pagination.
	 */
	query(filters: ComparisonQueryFilters = {}, capability = this.capability): CompareResponse[] {
		const project = this.authorize(capability, "read", filters.project);
		const conditions: string[] = [];
		const params: Record<string, unknown> = {};

		if (project !== "*") {
			conditions.push("project = @project");
			params["project"] = project;
		}

		const where =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const limit = Math.min(filters.limit ?? 20, 100);
		const offset = filters.offset ?? 0;

		const sql = `
		SELECT c.*, a.prompt, a.system_prompt, a.results, a.summary FROM comparison_results c
		JOIN authorized_comparison_results a USING(id)
      ${where}
      ORDER BY created_at DESC
      LIMIT @limit OFFSET @offset
    `;

		const rows = this.db
			.prepare(sql)
			.all({ ...params, limit, offset }) as ComparisonRow[];
		return rows.map((row) => this.mapRow(row));
	}

	export(filters: ComparisonQueryFilters = {}, capability = this.capability): CompareResponse[] {
		this.authorize(capability, "export", filters.project);
		return this.query(filters, capability);
	}

	purgeExpired(now = new Date(), capability = this.capability): ComparisonPurgeEvidence {
		if (Number.isNaN(now.getTime())) return { status: "INDETERMINATE", deletedIds: [] };
		const project = this.authorize(capability, "purge");
		const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
		const ids = this.db.prepare(`SELECT id FROM comparison_results WHERE created_at < ?${project === "*" ? "" : " AND project = ?"}`).all(...(project === "*" ? [cutoff] : [cutoff, project])) as Array<{ id: string }>;
		try {
			const remove = this.db.transaction(() => ids.forEach(({ id }) => {
				this.db.prepare("DELETE FROM authorized_comparison_results WHERE id = ?").run(id);
				this.db.prepare("DELETE FROM comparison_results WHERE id = ?").run(id);
			}));
			remove();
			const deletedIds = ids.map(({ id }) => id);
			const remaining = deletedIds.some((id) => this.db.prepare("SELECT 1 FROM comparison_results WHERE id = ?").get(id));
			return { status: remaining ? "FAILED" : "success", deletedIds };
		} catch { return { status: "FAILED", deletedIds: [] }; }
	}

	deleteById(id: string, capability = this.capability): ComparisonPurgeEvidence {
		const project = this.authorize(capability, "purge");
		const row = this.db.prepare(`SELECT id FROM comparison_results WHERE id = ?${project === "*" ? "" : " AND project = ?"}`).get(...(project === "*" ? [id] : [id, project]));
		if (!row) return { status: "NOT_VERIFIED", deletedIds: [] };
		try {
			this.db.transaction(() => { this.db.prepare("DELETE FROM authorized_comparison_results WHERE id = ?").run(id); this.db.prepare("DELETE FROM comparison_results WHERE id = ?").run(id); })();
			return { status: this.db.prepare("SELECT 1 FROM comparison_results WHERE id = ?").get(id) ? "FAILED" : "success", deletedIds: [id] };
		} catch { return { status: "FAILED", deletedIds: [] }; }
	}

	private authorize(capability: ComparisonCapability | undefined, operation: "persist" | "read" | "export" | "purge", project?: string): string {
		const scope = capability?.authorize(operation, project);
		if (!scope) throw new Error("Comparison capability denied");
		return scope;
	}

	/**
	 * Map a database row to a CompareResponse.
	 */
	private mapRow(row: ComparisonRow): CompareResponse {
		return {
			id: row.id,
			prompt: row.prompt,
			results: JSON.parse(row.results) as CompareResponse["results"],
			summary: JSON.parse(row.summary) as CompareResponse["summary"],
			createdAt: row.created_at,
		};
	}
}
