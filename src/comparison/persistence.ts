/**
 * Comparison Store — SQLite persistence for comparison results.
 *
 * Follows the same better-sqlite3 patterns as CostTracker and Vault.
 * Stores full comparison results as JSON blobs with indexed project/date.
 */

import type Database from "better-sqlite3";
import { GLOBAL_PROJECT } from "../core/constants.js";
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

/**
 * ComparisonStore — read/write for the comparison_results table.
 *
 * Requires the table to already exist (created by initializeDb via
 * migration 007 or inline CREATE TABLE).
 */
export class ComparisonStore {
	private readonly insertStmt: Database.Statement;
	private readonly getByIdStmt: Database.Statement;

	constructor(private readonly db: Database.Database) {
		// Ensure table exists (idempotent — matches migration 007)
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS comparison_results (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        system_prompt TEXT,
        models TEXT NOT NULL,
        results TEXT NOT NULL,
        summary TEXT NOT NULL,
        project TEXT NOT NULL DEFAULT '${GLOBAL_PROJECT}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_comparison_project ON comparison_results(project);
      CREATE INDEX IF NOT EXISTS idx_comparison_created ON comparison_results(created_at);
    `);

		this.insertStmt = this.db.prepare(`
      INSERT INTO comparison_results (id, prompt, system_prompt, models, results, summary, project, created_at)
      VALUES (@id, @prompt, @systemPrompt, @models, @results, @summary, @project, @createdAt)
    `);

		this.getByIdStmt = this.db.prepare(
			"SELECT * FROM comparison_results WHERE id = ?",
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
	): void {
		this.insertStmt.run({
			id: result.id,
			prompt: result.prompt,
			systemPrompt: systemPrompt ?? null,
			models: JSON.stringify(models ?? result.results.map((r) => r.model)),
			results: JSON.stringify(result.results),
			summary: JSON.stringify(result.summary),
			project: project ?? GLOBAL_PROJECT,
			createdAt: result.createdAt,
		});
	}

	/**
	 * Retrieve a single comparison by ID.
	 */
	getById(id: string): CompareResponse | null {
		const row = this.getByIdStmt.get(id) as ComparisonRow | undefined;
		if (!row) return null;
		return this.mapRow(row);
	}

	/**
	 * List comparisons with optional project filter and pagination.
	 */
	query(filters: ComparisonQueryFilters = {}): CompareResponse[] {
		const conditions: string[] = [];
		const params: Record<string, unknown> = {};

		if (filters.project) {
			conditions.push("project = @project");
			params["project"] = filters.project;
		}

		const where =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const limit = Math.min(filters.limit ?? 20, 100);
		const offset = filters.offset ?? 0;

		const sql = `
      SELECT * FROM comparison_results
      ${where}
      ORDER BY created_at DESC
      LIMIT @limit OFFSET @offset
    `;

		const rows = this.db
			.prepare(sql)
			.all({ ...params, limit, offset }) as ComparisonRow[];
		return rows.map((row) => this.mapRow(row));
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
