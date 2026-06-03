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
  /** Optional API key ID for truthful per-key correlation. */
  apiKeyId?: string;
  /** Optional user ID for multi-tenant tracking. */
  userId?: string;
  tokensIn?: number;
  tokensOut?: number;
  totalTokens?: number;
  costUsd?: number | null;
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
  userId: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

/** Query filters for usage records. */
export interface UsageQuery {
  provider?: string;
  keyName?: string;
  model?: string;
  project?: string;
  userId?: string;
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
  totalTokens: number;
  totalCostUsd: number | null;
  knownCostUsd: number;
  unknownCostRequestCount: number;
  hasUnknownCost: boolean;
  avgLatencyMs: number;
  breakdown: UsageBreakdown[];
}

export interface AdmissionIdentity {
  userId?: string;
  apiKeyId?: string;
}

export interface AdmissionSnapshot extends UsageSummary {
  oldestRequestAt: string | null;
}

export interface AdmissionQuery {
  identity?: AdmissionIdentity;
  from?: string;
  to?: string;
  scope?: 'budget' | 'rateLimit';
}

/** A single breakdown entry for aggregated queries. */
export interface UsageBreakdown {
  key: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  costUsd: number | null;
  knownCostUsd: number;
  unknownCostRequestCount: number;
  hasUnknownCost: boolean;
  avgLatencyMs: number;
}

/** SQLite row for raw usage queries. */
interface UsageRow {
  id: number;
  provider: string;
  key_name: string;
  model: string;
  project: string;
  user_id: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
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
  total_tokens: number;
  total_cost_usd: number | null;
  known_cost_usd: number;
  unknown_cost_request_count: number;
  avg_latency_ms: number;
}

/** SQLite row for summary queries. */
interface SummaryRow {
  total_requests: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_tokens: number;
  total_cost_usd: number | null;
  known_cost_usd: number;
  unknown_cost_request_count: number;
  avg_latency_ms: number;
}

interface OldestRow {
  oldest_at: string | null;
}

interface BufferedUsageEntry extends UsageEntry {
  keyName: string;
  project: string;
  recordedAt: string;
  recordedAtMs: number;
}

interface InFlightUsageEntry {
  id: number;
  provider: string;
  model: string;
  project: string;
  apiKeyId?: string;
  userId?: string;
  keyName: string;
  startedAt: string;
  startedAtMs: number;
  tokensIn?: number;
  tokensOut?: number;
  totalTokens?: number;
  costUsd?: number | null;
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
  private readonly buffer: BufferedUsageEntry[] = [];
  private readonly inFlightStreams = new Map<number, InFlightUsageEntry>();
  private readonly flushInterval: ReturnType<typeof setInterval>;
  private readonly insertStmt: Database.Statement;
  private nextInFlightStreamId = 1;

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
      INSERT INTO usage_logs (provider, key_name, model, project, user_id, tokens_in, tokens_out, total_tokens, cost_usd, latency_ms, success, error_message, created_at)
      VALUES (@provider, @keyName, @model, @project, @userId, @tokensIn, @tokensOut, @totalTokens, @costUsd, @latencyMs, @success, @errorMessage, datetime('now'))
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
    const hasExactSplit = hasExactSplitUsage(entry);
    const totalTokens = hasExactSplit
      ? entry.tokensIn + entry.tokensOut
      : entry.totalTokens;

    // Auto-calculate cost if not provided
    if (entry.costUsd === undefined && hasExactSplit) {
      entry.costUsd = calculateCost(entry.model, entry.tokensIn, entry.tokensOut);
    }

    this.buffer.push(this.createBufferedEntry({
      ...entry,
      totalTokens,
    }));
  }

  /**
   * Flush the in-memory buffer to SQLite in a single transaction.
   */
  flush(): void {
    if (this.buffer.length === 0) return;

    const entries = this.buffer.splice(0, this.buffer.length);

    const insertMany = this.db.transaction((items: BufferedUsageEntry[]) => {
      for (const entry of items) {
        this.insertStmt.run({
          provider: entry.provider,
          keyName: entry.keyName,
          model: entry.model,
          project: entry.project,
          userId: entry.userId ?? null,
          tokensIn: entry.tokensIn ?? null,
          tokensOut: entry.tokensOut ?? null,
          totalTokens: hasExactSplitUsage(entry)
            ? entry.tokensIn + entry.tokensOut
            : entry.totalTokens ?? null,
          costUsd: entry.costUsd ?? null,
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
    if (filters.keyName) {
      conditions.push('key_name = @keyName');
      params['keyName'] = filters.keyName;
    }
    if (filters.model) {
      conditions.push('model = @model');
      params['model'] = filters.model;
    }
    if (filters.project) {
      conditions.push('project = @project');
      params['project'] = filters.project;
    }
    if (filters.userId) {
      conditions.push('user_id = @userId');
      params['userId'] = filters.userId;
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

    const sql = `SELECT id, provider, key_name, model, project, user_id, tokens_in, tokens_out, total_tokens, cost_usd, latency_ms, success, error_message, created_at FROM usage_logs ${where} ORDER BY created_at DESC LIMIT @limit`;

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
    if (filters.keyName) {
      conditions.push('key_name = @keyName');
      params['keyName'] = filters.keyName;
    }
    if (filters.model) {
      conditions.push('model = @model');
      params['model'] = filters.model;
    }
    if (filters.project) {
      conditions.push('project = @project');
      params['project'] = filters.project;
    }
    if (filters.userId) {
      conditions.push('user_id = @userId');
      params['userId'] = filters.userId;
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
        COALESCE(SUM(CASE WHEN tokens_in IS NOT NULL THEN tokens_in ELSE 0 END), 0) as total_tokens_in,
        COALESCE(SUM(CASE WHEN tokens_out IS NOT NULL THEN tokens_out ELSE 0 END), 0) as total_tokens_out,
        COALESCE(SUM(CASE
          WHEN tokens_in IS NOT NULL AND tokens_out IS NOT NULL THEN tokens_in + tokens_out
          WHEN total_tokens IS NOT NULL THEN total_tokens
          ELSE 0
        END), 0) as total_tokens,
        CASE
          WHEN COUNT(*) = 0 THEN 0.0
          WHEN SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) > 0 THEN NULL
          ELSE COALESCE(SUM(cost_usd), 0.0)
        END as total_cost_usd,
        COALESCE(SUM(cost_usd), 0.0) as known_cost_usd,
        COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END), 0) as unknown_cost_request_count,
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
      totalTokens: totals.total_tokens,
      totalCostUsd: totals.total_cost_usd,
      knownCostUsd: totals.known_cost_usd,
      unknownCostRequestCount: totals.unknown_cost_request_count,
      hasUnknownCost: totals.unknown_cost_request_count > 0,
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
    identity?: { apiKeyId?: string; userId?: string },
  ): StreamRecorder {
    return new StreamRecorder(this, provider, model, project, identity);
  }

  admissionSnapshot(query: AdmissionQuery = {}): AdmissionSnapshot {
    const filters = this.admissionQueryToUsageQuery(query);
    const persisted = this.summary(filters);
    const buffered = this.summarizeBufferedEntries(this.buffer, query);
    const inFlight = this.summarizeInFlightEntries(query);
    const oldestRequestAt = minIsoDate(
      this.getOldestCreatedAt(filters),
      buffered.oldestRequestAt,
      inFlight.oldestRequestAt,
    );

    return {
      ...mergeUsageSummaries([persisted, buffered, inFlight]),
      oldestRequestAt,
    };
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
  checkBudget(
    identity: string | AdmissionIdentity,
    budgetUsd: number,
  ): { allowed: boolean; remaining: number } {
    // Budget of 0 means unlimited
    if (budgetUsd <= 0) {
      return { allowed: true, remaining: Infinity };
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const normalizedIdentity = normalizeBudgetIdentity(identity);
    const snapshot = this.admissionSnapshot({
      identity: normalizedIdentity,
      scope: 'budget',
      from: monthStart,
      to: now.toISOString(),
    });

    if (snapshot.totalCostUsd === null) {
      return { allowed: false, remaining: 0 };
    }

    const used = snapshot.totalCostUsd;
    const remaining = Math.max(0, budgetUsd - used);

    return {
      allowed: remaining > 0,
      remaining,
    };
  }

  checkRateLimit(
    identity: AdmissionIdentity,
    config: { max: number; windowMs: number },
  ): { allowed: boolean; retryAfter?: number } {
    const windowStart = new Date(Date.now() - config.windowMs).toISOString();
    const snapshot = this.admissionSnapshot({
      identity,
      scope: 'rateLimit',
      from: windowStart,
      to: new Date().toISOString(),
    });

    if (snapshot.totalRequests >= config.max) {
      const oldestAt = snapshot.oldestRequestAt
        ? new Date(snapshot.oldestRequestAt).getTime()
        : Date.now();
      const windowEnd = oldestAt + config.windowMs;
      const retryAfter = Math.max(0, windowEnd - Date.now());

      return { allowed: false, retryAfter };
    }

    return { allowed: true };
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
        COALESCE(SUM(CASE WHEN tokens_in IS NOT NULL THEN tokens_in ELSE 0 END), 0) as total_tokens_in,
        COALESCE(SUM(CASE WHEN tokens_out IS NOT NULL THEN tokens_out ELSE 0 END), 0) as total_tokens_out,
        COALESCE(SUM(CASE
          WHEN tokens_in IS NOT NULL AND tokens_out IS NOT NULL THEN tokens_in + tokens_out
          WHEN total_tokens IS NOT NULL THEN total_tokens
          ELSE 0
        END), 0) as total_tokens,
        CASE
          WHEN COUNT(*) = 0 THEN 0.0
          WHEN SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) > 0 THEN NULL
          ELSE COALESCE(SUM(cost_usd), 0.0)
        END as total_cost_usd,
        COALESCE(SUM(cost_usd), 0.0) as known_cost_usd,
        COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END), 0) as unknown_cost_request_count,
        COALESCE(AVG(latency_ms), 0) as avg_latency_ms
      FROM usage_logs ${where}
      GROUP BY ${groupColumn}
      ORDER BY known_cost_usd DESC, request_count DESC
    `;

    const rows = this.db.prepare(sql).all(params) as AggregateRow[];

    return rows.map((row) => ({
      key: row.group_key,
      requests: row.request_count,
      tokensIn: row.total_tokens_in,
      tokensOut: row.total_tokens_out,
      totalTokens: row.total_tokens,
      costUsd: row.total_cost_usd,
      knownCostUsd: row.known_cost_usd,
      unknownCostRequestCount: row.unknown_cost_request_count,
      hasUnknownCost: row.unknown_cost_request_count > 0,
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
      userId: row.user_id,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      totalTokens: row.total_tokens,
      costUsd: row.cost_usd,
      latencyMs: row.latency_ms,
      success: row.success === 1,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    };
  }

  private createBufferedEntry(entry: UsageEntry): BufferedUsageEntry {
    const recordedAtMs = Date.now();

    return {
      ...entry,
      keyName: entry.apiKeyId ?? entry.keyName ?? 'default',
      project: entry.project ?? GLOBAL_PROJECT,
      recordedAt: new Date(recordedAtMs).toISOString(),
      recordedAtMs,
    };
  }

  private admissionQueryToUsageQuery(query: AdmissionQuery): UsageQuery {
    const filters: UsageQuery = {
      from: query.from ? toSqliteDateTime(query.from) : undefined,
      to: query.to ? toSqliteDateTime(query.to) : undefined,
    };

    const identity = query.identity;
    if (!identity) {
      return filters;
    }

    if (query.scope === 'rateLimit') {
      if (identity.apiKeyId) {
        filters.keyName = identity.apiKeyId;
      } else if (identity.userId) {
        filters.userId = identity.userId;
      }

      return filters;
    }

    if (identity.userId) {
      filters.userId = identity.userId;
    } else if (identity.apiKeyId) {
      filters.keyName = identity.apiKeyId;
    }

    return filters;
  }

  private buildWhereClause(filters: UsageQuery): { where: string; params: Record<string, unknown> } {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters.provider) {
      conditions.push('provider = @provider');
      params['provider'] = filters.provider;
    }
    if (filters.keyName) {
      conditions.push('key_name = @keyName');
      params['keyName'] = filters.keyName;
    }
    if (filters.model) {
      conditions.push('model = @model');
      params['model'] = filters.model;
    }
    if (filters.project) {
      conditions.push('project = @project');
      params['project'] = filters.project;
    }
    if (filters.userId) {
      conditions.push('user_id = @userId');
      params['userId'] = filters.userId;
    }
    if (filters.from) {
      conditions.push('created_at >= @from');
      params['from'] = filters.from;
    }
    if (filters.to) {
      conditions.push('created_at <= @to');
      params['to'] = filters.to;
    }

    return {
      where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      params,
    };
  }

  private getOldestCreatedAt(filters: UsageQuery): string | null {
    const { where, params } = this.buildWhereClause(filters);
    const row = this.db.prepare(`SELECT MIN(created_at) as oldest_at FROM usage_logs ${where}`).get(params) as OldestRow;
    return row?.oldest_at ?? null;
  }

  private summarizeBufferedEntries(
    entries: readonly BufferedUsageEntry[],
    query: AdmissionQuery,
  ): AdmissionSnapshot {
    return summarizeUsageEntries(
      entries.filter((entry) => matchesAdmissionQuery(entry, query, entry.recordedAtMs)),
      (entry) => entry.recordedAt,
    );
  }

  private summarizeInFlightEntries(query: AdmissionQuery): AdmissionSnapshot {
    return summarizeUsageEntries(
      [...this.inFlightStreams.values()].filter((entry) => matchesAdmissionQuery(entry, query, entry.startedAtMs)),
      (entry) => entry.startedAt,
    );
  }

  registerInFlightStream(
    provider: string,
    model: string,
    project?: string,
    identity?: AdmissionIdentity,
  ): number {
    const streamId = this.nextInFlightStreamId++;
    const startedAtMs = Date.now();

    this.inFlightStreams.set(streamId, {
      id: streamId,
      provider,
      model,
      project: project ?? GLOBAL_PROJECT,
      apiKeyId: identity?.apiKeyId,
      userId: identity?.userId,
      keyName: identity?.apiKeyId ?? 'default',
      startedAt: new Date(startedAtMs).toISOString(),
      startedAtMs,
    });

    return streamId;
  }

  updateInFlightStream(streamId: number, tokens?: { tokensIn?: number; tokensOut?: number }): void {
    const current = this.inFlightStreams.get(streamId);
    if (!current) {
      return;
    }

    const nextTokensIn = tokens?.tokensIn !== undefined ? tokens.tokensIn : current.tokensIn;
    const nextTokensOut = tokens?.tokensOut !== undefined ? tokens.tokensOut : current.tokensOut;
    const hasExactSplit = typeof nextTokensIn === 'number' && typeof nextTokensOut === 'number';

    this.inFlightStreams.set(streamId, {
      ...current,
      tokensIn: nextTokensIn,
      tokensOut: nextTokensOut,
      totalTokens: hasExactSplit ? nextTokensIn + nextTokensOut : undefined,
      costUsd: hasExactSplit ? calculateCost(current.model, nextTokensIn, nextTokensOut) : undefined,
    });
  }

  completeInFlightStream(streamId: number): void {
    this.inFlightStreams.delete(streamId);
  }
}

function hasExactSplitUsage(entry: Pick<UsageEntry, 'tokensIn' | 'tokensOut'>): entry is {
  tokensIn: number;
  tokensOut: number;
} {
  return typeof entry.tokensIn === 'number' && typeof entry.tokensOut === 'number';
}

function normalizeBudgetIdentity(
  identity: string | { userId?: string; apiKeyId?: string },
): { userId?: string; apiKeyId?: string } {
  if (typeof identity === 'string') {
    return { userId: identity };
  }

  return identity;
}

// ── StreamRecorder ─────────────────────────────────────────

/**
 * Accumulates token usage from streaming chunks and writes a final
 * UsageEntry to the CostTracker when the stream completes.
 */
export class StreamRecorder {
  private _tokensIn = 0;
  private _tokensOut = 0;
  private _hasTokensIn = false;
  private _hasTokensOut = false;
  private _finished = false;
  private readonly _startTime: number;
  private readonly _streamId: number;

  constructor(
    private readonly tracker: CostTracker,
    private readonly provider: string,
    private readonly model: string,
    private readonly project?: string,
    private readonly identity?: { apiKeyId?: string; userId?: string },
  ) {
    this._startTime = Date.now();
    this._streamId = this.tracker.registerInFlightStream(provider, model, project, identity);
  }

  /**
   * Accumulate token counts from a streaming chunk.
   * Call this for every chunk that reports partial usage.
   */
  addChunk(tokens?: { tokensIn?: number; tokensOut?: number }, _contentLength = 0): void {
    if (this._finished) return;
    if (tokens?.tokensIn !== undefined) {
      this._tokensIn = tokens.tokensIn;
      this._hasTokensIn = true;
    }
    if (tokens?.tokensOut !== undefined) {
      this._tokensOut = tokens.tokensOut;
      this._hasTokensOut = true;
    }

    this.tracker.updateInFlightStream(this._streamId, tokens);
  }

  /**
   * Finalize the stream and write the usage record.
   */
  finish(errorMessage?: string): void {
    if (this._finished) return;
    this._finished = true;
    this.tracker.completeInFlightStream(this._streamId);

    const latencyMs = Date.now() - this._startTime;

    this.tracker.record({
      provider: this.provider,
      apiKeyId: this.identity?.apiKeyId,
      model: this.model,
      project: this.project,
      userId: this.identity?.userId,
      tokensIn: this._hasTokensIn ? this._tokensIn : undefined,
      tokensOut: this._hasTokensOut ? this._tokensOut : undefined,
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

function matchesAdmissionQuery(
  entry: { userId?: string | null; keyName?: string; apiKeyId?: string },
  query: AdmissionQuery,
  timestampMs: number,
): boolean {
  if (!matchesDateRange(timestampMs, query.from, query.to)) {
    return false;
  }

  const identity = query.identity;
  if (!identity?.userId && !identity?.apiKeyId) {
    return true;
  }

  if (query.scope === 'rateLimit') {
    if (identity.apiKeyId) {
      return (entry.apiKeyId ?? entry.keyName ?? 'default') === identity.apiKeyId;
    }

    return entry.userId === identity.userId;
  }

  if (identity.userId) {
    return entry.userId === identity.userId;
  }

  return (entry.apiKeyId ?? entry.keyName ?? 'default') === identity.apiKeyId;
}

function matchesDateRange(timestampMs: number, from?: string, to?: string): boolean {
  const fromMs = from ? Date.parse(from) : undefined;
  const toMs = to ? Date.parse(to) : undefined;

  if (fromMs !== undefined && Number.isFinite(fromMs) && timestampMs < fromMs) {
    return false;
  }
  if (toMs !== undefined && Number.isFinite(toMs) && timestampMs > toMs) {
    return false;
  }

  return true;
}

function summarizeUsageEntries<T extends {
  tokensIn?: number | null;
  tokensOut?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
  latencyMs?: number;
}>(entries: readonly T[], getTimestamp: (entry: T) => string): AdmissionSnapshot {
  const totalRequests = entries.length;
  const totalTokensIn = entries.reduce((sum, entry) => sum + (entry.tokensIn ?? 0), 0);
  const totalTokensOut = entries.reduce((sum, entry) => sum + (entry.tokensOut ?? 0), 0);
  const totalTokens = entries.reduce(
    (sum, entry) => sum + resolveTotalTokens(entry),
    0,
  );
  const knownCostUsd = entries.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);
  const unknownCostRequestCount = entries.reduce(
    (sum, entry) => sum + (entry.costUsd == null ? 1 : 0),
    0,
  );
  const avgLatencyMs = totalRequests === 0
    ? 0
    : Math.round(entries.reduce((sum, entry) => sum + (entry.latencyMs ?? 0), 0) / totalRequests);

  return {
    totalRequests,
    totalTokensIn,
    totalTokensOut,
    totalTokens,
    totalCostUsd: totalRequests === 0
      ? 0
      : unknownCostRequestCount > 0
        ? null
        : knownCostUsd,
    knownCostUsd,
    unknownCostRequestCount,
    hasUnknownCost: unknownCostRequestCount > 0,
    avgLatencyMs,
    breakdown: [],
    oldestRequestAt: totalRequests > 0 ? minIsoDate(...entries.map(getTimestamp)) : null,
  };
}

function resolveTotalTokens(entry: {
  tokensIn?: number | null;
  tokensOut?: number | null;
  totalTokens?: number | null;
}): number {
  if (typeof entry.tokensIn === 'number' && typeof entry.tokensOut === 'number') {
    return entry.tokensIn + entry.tokensOut;
  }

  return entry.totalTokens ?? 0;
}

function mergeUsageSummaries(summaries: readonly UsageSummary[]): UsageSummary {
  const totalRequests = summaries.reduce((sum, summary) => sum + summary.totalRequests, 0);
  const knownCostUsd = summaries.reduce((sum, summary) => sum + summary.knownCostUsd, 0);
  const unknownCostRequestCount = summaries.reduce(
    (sum, summary) => sum + summary.unknownCostRequestCount,
    0,
  );
  const weightedLatencySum = summaries.reduce(
    (sum, summary) => sum + summary.avgLatencyMs * summary.totalRequests,
    0,
  );

  return {
    totalRequests,
    totalTokensIn: summaries.reduce((sum, summary) => sum + summary.totalTokensIn, 0),
    totalTokensOut: summaries.reduce((sum, summary) => sum + summary.totalTokensOut, 0),
    totalTokens: summaries.reduce((sum, summary) => sum + summary.totalTokens, 0),
    totalCostUsd: totalRequests === 0
      ? 0
      : unknownCostRequestCount > 0
        ? null
        : knownCostUsd,
    knownCostUsd,
    unknownCostRequestCount,
    hasUnknownCost: unknownCostRequestCount > 0,
    avgLatencyMs: totalRequests === 0 ? 0 : Math.round(weightedLatencySum / totalRequests),
    breakdown: [],
  };
}

function minIsoDate(...values: Array<string | null | undefined>): string | null {
  const normalized = values.filter((value): value is string => typeof value === 'string');
  if (normalized.length === 0) {
    return null;
  }

  return normalized.reduce((min, current) => current < min ? current : min);
}

function toSqliteDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}
