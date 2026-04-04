/**
 * Cost Tracker — in-memory buffered usage recording with SQLite persistence.
 *
 * Records per-request usage (tokens, cost, latency) and provides
 * query/aggregation capabilities. Uses batched writes to avoid
 * blocking the request path.
 *
 * Follows the same SQLite patterns as Vault (better-sqlite3, WAL mode).
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { calculateCost } from './pricing.js';
import { logger } from './logger.js';
import { GLOBAL_PROJECT } from './constants.js';
import { initializeDb } from '../vault/schema.js';

// ── Types ──────────────────────────────────────────────────

/** A single usage record to be written. */
export interface UsageEntry {
  provider: string;
  keyName?: string;
  model: string;
  project?: string;
  /** Optional user ID for multi-tenant tracking. */
  userId?: string;
  tokensIn: number;
  tokensOut: number;
  costUsd?: number;
  latencyMs: number;
  success: boolean;
  errorMessage?: string;
}

/** Row shape returned from usage_logs queries. */
export interface UsageRecord {
  id: number;
  provider: string;
  keyName: string;
  model: string;
  project: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

/** Query filters for usage records. */
export interface UsageQuery {
  provider?: string;
  model?: string;
  project?: string;
  from?: string;       // ISO date string
  to?: string;         // ISO date string
  groupBy?: 'provider' | 'model' | 'project' | 'hour' | 'day';
  limit?: number;
}

/** Aggregated usage summary. */
export interface UsageSummary {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  breakdown: UsageBreakdown[];
}

/** A single breakdown entry for aggregated queries. */
export interface UsageBreakdown {
  key: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  avgLatencyMs: number;
}

/** SQLite row for raw usage queries. */
interface UsageRow {
  id: number;
  provider: string;
  key_name: string;
  model: string;
  project: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  success: number;
  error_message: string | null;
  created_at: string;
}

/** SQLite row for aggregated queries. */
interface AggregateRow {
  group_key: string;
  request_count: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost_usd: number;
  avg_latency_ms: number;
}

/** SQLite row for summary queries. */
interface SummaryRow {
  total_requests: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost_usd: number;
  avg_latency_ms: number;
}

// ── Configuration ──────────────────────────────────────────

/** Default flush interval in milliseconds. */
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;

/** Default query limit. */
const DEFAULT_QUERY_LIMIT = 1000;

export interface CostTrackerOptions {
  /** Path to the SQLite database file. */
  dbPath: string;
  /** Flush interval in ms (default: 5000). */
  flushIntervalMs?: number;
  /** Master key buffer (needed for schema initialization). */
  masterKey?: Buffer;
}

// ── CostTracker ────────────────────────────────────────────

export class CostTracker {
  private readonly db: Database.Database;
  private readonly buffer: UsageEntry[] = [];
  private readonly flushInterval: ReturnType<typeof setInterval>;
  private readonly insertStmt: Database.Statement;

  constructor(options: CostTrackerOptions) {
    const { dbPath, flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS } = options;

    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    // Initialize schema (creates usage_logs + price_config tables)
    initializeDb(this.db);

    // Prepare the insert statement once
    this.insertStmt = this.db.prepare(`
      INSERT INTO usage_logs (provider, key_name, model, project, tokens_in, tokens_out, cost_usd, latency_ms, success, error_message, created_at)
      VALUES (@provider, @keyName, @model, @project, @tokensIn, @tokensOut, @costUsd, @latencyMs, @success, @errorMessage, datetime('now'))
    `);

    // Periodic flush — unref so it doesn't keep the process alive
    this.flushInterval = setInterval(() => this.flush(), flushIntervalMs);
    this.flushInterval.unref();

    logger.debug({ dbPath, flushIntervalMs }, 'CostTracker initialized');
  }

  /**
   * Record a usage entry into the in-memory buffer.
   * Automatically calculates cost if not provided.
   */
  record(entry: UsageEntry): void {
    // Auto-calculate cost if not provided
    if (entry.costUsd === undefined) {
      entry.costUsd = calculateCost(entry.model, entry.tokensIn, entry.tokensOut);
    }
    this.buffer.push(entry);
  }

  /**
   * Flush the in-memory buffer to SQLite in a single transaction.
   */
  flush(): void {
    if (this.buffer.length === 0) return;

    const entries = this.buffer.splice(0, this.buffer.length);

    const insertMany = this.db.transaction((items: UsageEntry[]) => {
      for (const entry of items) {
        this.insertStmt.run({
          provider: entry.provider,
          keyName: entry.keyName ?? 'default',
          model: entry.model,
          project: entry.project ?? GLOBAL_PROJECT,
          tokensIn: entry.tokensIn,
          tokensOut: entry.tokensOut,
          costUsd: entry.costUsd ?? 0,
          latencyMs: entry.latencyMs,
          success: entry.success ? 1 : 0,
          errorMessage: entry.errorMessage ?? null,
        });
      }
    });

    try {
      insertMany(entries);
      logger.debug({ count: entries.length }, 'Flushed usage records to SQLite');
    } catch (error) {
      // Re-add entries to buffer on failure so they're not lost
      this.buffer.unshift(...entries);
      logger.error({ error }, 'Failed to flush usage records');
    }
  }

  /** Get the current buffer size (for testing/monitoring). */
  get bufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Query usage records with optional filters.
   */
  query(filters: UsageQuery = {}): UsageRecord[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters.provider) {
      conditions.push('provider = @provider');
      params['provider'] = filters.provider;
    }
    if (filters.model) {
      conditions.push('model = @model');
      params['model'] = filters.model;
    }
    if (filters.project) {
      conditions.push('project = @project');
      params['project'] = filters.project;
    }
    if (filters.from) {
      conditions.push('created_at >= @from');
      params['from'] = filters.from;
    }
    if (filters.to) {
      conditions.push('created_at <= @to');
      params['to'] = filters.to;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? DEFAULT_QUERY_LIMIT;

    const sql = `SELECT id, provider, key_name, model, project, tokens_in, tokens_out, cost_usd, latency_ms, success, error_message, created_at FROM usage_logs ${where} ORDER BY created_at DESC LIMIT @limit`;

    const rows = this.db.prepare(sql).all({ ...params, limit }) as UsageRow[];

    return rows.map(this.mapRow);
  }

  /**
   * Get an aggregated usage summary with optional filters and groupBy.
   */
  summary(filters: UsageQuery = {}): UsageSummary {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters.provider) {
      conditions.push('provider = @provider');
      params['provider'] = filters.provider;
    }
    if (filters.model) {
      conditions.push('model = @model');
      params['model'] = filters.model;
    }
    if (filters.project) {
      conditions.push('project = @project');
      params['project'] = filters.project;
    }
    if (filters.from) {
      conditions.push('created_at >= @from');
      params['from'] = filters.from;
    }
    if (filters.to) {
      conditions.push('created_at <= @to');
      params['to'] = filters.to;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get totals
    const totalSql = `
      SELECT
        COUNT(*) as total_requests,
        COALESCE(SUM(tokens_in), 0) as total_tokens_in,
        COALESCE(SUM(tokens_out), 0) as total_tokens_out,
        COALESCE(SUM(cost_usd), 0.0) as total_cost_usd,
        COALESCE(AVG(latency_ms), 0) as avg_latency_ms
      FROM usage_logs ${where}
    `;

    const totals = this.db.prepare(totalSql).get(params) as SummaryRow;

    // Get breakdown if groupBy specified
    let breakdown: UsageBreakdown[] = [];
    if (filters.groupBy) {
      breakdown = this.getBreakdown(filters.groupBy, where, params);
    }

    return {
      totalRequests: totals.total_requests,
      totalTokensIn: totals.total_tokens_in,
      totalTokensOut: totals.total_tokens_out,
      totalCostUsd: totals.total_cost_usd,
      avgLatencyMs: Math.round(totals.avg_latency_ms),
      breakdown,
    };
  }

  /**
   * Create a StreamRecorder for accumulating streaming usage.
   *
   * Usage:
   *   const recorder = costTracker.recordStream('openai', 'gpt-4o');
   *   // ... for each chunk: recorder.addChunk({ tokensOut: n }) ...
   *   recorder.finish(); // writes final record to buffer
   */
  recordStream(
    provider: string,
    model: string,
    project?: string,
  ): StreamRecorder {
    return new StreamRecorder(this, provider, model, project);
  }

  /**
   * Check whether a user has remaining budget for the current month.
   *
   * Queries usage_logs by key_name (correlated to userId by the auth middleware)
   * to get the user's total spend since the start of the current month.
   *
   * @param userId - The user ID to check budget for.
   * @param budgetUsd - The maximum monthly budget in USD. 0 = unlimited.
   * @returns Whether the request is allowed and the remaining budget.
   */
  checkBudget(userId: string, budgetUsd: number): { allowed: boolean; remaining: number } {
    // Budget of 0 means unlimited
    if (budgetUsd <= 0) {
      return { allowed: true, remaining: Infinity };
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const row = this.db
      .prepare<[string, string], { total_cost: number }>(
        `SELECT COALESCE(SUM(cost_usd), 0.0) as total_cost
         FROM usage_logs
         WHERE key_name = ? AND created_at >= ?`,
      )
      .get(userId, monthStart);

    const used = row?.total_cost ?? 0;
    const remaining = Math.max(0, budgetUsd - used);

    return {
      allowed: remaining > 0,
      remaining,
    };
  }

  /**
   * Clean up: flush remaining buffer, stop interval, close DB.
   */
  destroy(): void {
    clearInterval(this.flushInterval);
    this.flush();
    this.db.close();
    logger.debug('CostTracker destroyed');
  }

  // ── Private helpers ────────────────────────────────────

  private getBreakdown(
    groupBy: string,
    where: string,
    params: Record<string, unknown>,
  ): UsageBreakdown[] {
    let groupColumn: string;
    switch (groupBy) {
      case 'provider':
        groupColumn = 'provider';
        break;
      case 'model':
        groupColumn = 'model';
        break;
      case 'project':
        groupColumn = 'project';
        break;
      case 'hour':
        groupColumn = "strftime('%Y-%m-%d %H:00', created_at)";
        break;
      case 'day':
        groupColumn = "strftime('%Y-%m-%d', created_at)";
        break;
      default:
        return [];
    }

    const sql = `
      SELECT
        ${groupColumn} as group_key,
        COUNT(*) as request_count,
        COALESCE(SUM(tokens_in), 0) as total_tokens_in,
        COALESCE(SUM(tokens_out), 0) as total_tokens_out,
        COALESCE(SUM(cost_usd), 0.0) as total_cost_usd,
        COALESCE(AVG(latency_ms), 0) as avg_latency_ms
      FROM usage_logs ${where}
      GROUP BY ${groupColumn}
      ORDER BY total_cost_usd DESC
    `;

    const rows = this.db.prepare(sql).all(params) as AggregateRow[];

    return rows.map((row) => ({
      key: row.group_key,
      requests: row.request_count,
      tokensIn: row.total_tokens_in,
      tokensOut: row.total_tokens_out,
      costUsd: row.total_cost_usd,
      avgLatencyMs: Math.round(row.avg_latency_ms),
    }));
  }

  private mapRow(row: UsageRow): UsageRecord {
    return {
      id: row.id,
      provider: row.provider,
      keyName: row.key_name,
      model: row.model,
      project: row.project,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      costUsd: row.cost_usd,
      latencyMs: row.latency_ms,
      success: row.success === 1,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    };
  }
}

// ── StreamRecorder ─────────────────────────────────────────

/**
 * Accumulates token usage from streaming chunks and writes a final
 * UsageEntry to the CostTracker when the stream completes.
 */
export class StreamRecorder {
  private _tokensIn = 0;
  private _tokensOut = 0;
  private _charCount = 0;
  private _finished = false;
  private readonly _startTime: number;

  constructor(
    private readonly tracker: CostTracker,
    private readonly provider: string,
    private readonly model: string,
    private readonly project?: string,
  ) {
    this._startTime = Date.now();
  }

  /**
   * Accumulate token counts from a streaming chunk.
   * Call this for every chunk that reports partial usage.
   */
  addChunk(tokens?: { tokensIn?: number; tokensOut?: number }, contentLength = 0): void {
    if (this._finished) return;
    if (tokens?.tokensIn !== undefined) this._tokensIn = tokens.tokensIn;
    if (tokens?.tokensOut !== undefined) this._tokensOut = tokens.tokensOut;
    this._charCount += contentLength;
  }

  /**
   * Finalize the stream and write the usage record.
   *
   * If the provider didn't report per-chunk tokens, estimates
   * output tokens from accumulated character count (~4 chars/token).
   */
  finish(errorMessage?: string): void {
    if (this._finished) return;
    this._finished = true;

    const latencyMs = Date.now() - this._startTime;
    const tokensOut = this._tokensOut > 0
      ? this._tokensOut
      : Math.ceil(this._charCount / 4);

    this.tracker.record({
      provider: this.provider,
      model: this.model,
      project: this.project,
      tokensIn: this._tokensIn,
      tokensOut,
      latencyMs,
      success: !errorMessage,
      errorMessage,
    });
  }

  /** Whether finish() has been called. */
  get finished(): boolean {
    return this._finished;
  }

  /** Current accumulated input tokens. */
  get tokensIn(): number {
    return this._tokensIn;
  }

  /** Current accumulated output tokens (0 if not yet reported by provider). */
  get tokensOut(): number {
    return this._tokensOut;
  }
}
