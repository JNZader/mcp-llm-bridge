/**
 * RequestLogger - SQLite-based request logging
 * 
 * Implements non-blocking async logging with automatic truncation
 * of large payloads. Supports querying with filters and cleanup.
 * 
 * @module logging/request-logger
 */

import type Database from 'better-sqlite3';
import { LOG_QUERY_STATUS, type LogContext, type LogQuery, type LogsResponse, type LogEntryPublic } from './types.js';
import { parseRequestLogTelemetryInput } from '../core/telemetry-contracts.js';
import { normalizeTelemetryFailure } from '../core/telemetry-failure.js';
import { RETENTION_SINKS, assertSafeTelemetryMetadata, verifyRetention, type RetentionVerification } from '../telemetry/retention.js';

/**
 * Input for capture method (direct logging)
 */
export interface DirectCaptureInput {
  provider: string;
  model: string;
  correlationId?: string;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  latencyMs: number;
  error?: string;
  attempts?: number;
  requestData?: string;
  responseData?: string;
}

/**
 * Input for captureStart method
 */
export interface CaptureStartInput {
  provider: string;
  model: string;
  correlationId?: string;
  startTime?: number;
}

/**
 * Input for captureEnd method
 */
export interface CaptureEndInput {
  provider?: string;
  model?: string;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  error?: Error;
  attempts?: number;
  requestData?: unknown;
  responseData?: unknown;
}

/**
 * Options for cleanup method
 */
export interface CleanupOptions {
  olderThanDays: number;
  beforeTimestamp: number;
}

/**
 * RequestLogger class for logging LLM requests to SQLite
 */
export class RequestLogger {
  private db: Database.Database;

  private normalizeOptionalNumber(value: number | null | undefined): number | undefined {
    return typeof value === 'number' ? value : undefined;
  }

  private resolveTotalTokens(input: {
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  }): number | undefined {
    if (typeof input.totalTokens === 'number') {
      return input.totalTokens;
    }

    if (typeof input.inputTokens === 'number' && typeof input.outputTokens === 'number') {
      return input.inputTokens + input.outputTokens;
    }

    return undefined;
  }

  /**
   * Create a new RequestLogger instance
   * @param db - better-sqlite3 Database instance
   */
  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Start request tracking
   * @param input - Provider and model information, optionally with startTime
   * @returns LogContext with timing and request ID
   */
  captureStart(input: CaptureStartInput): LogContext {
    assertSafeTelemetryMetadata(input, ['provider', 'model', 'correlationId', 'startTime']);
    return {
      startTime: input.startTime ?? Date.now(),
      provider: input.provider,
      model: input.model,
      correlationId: input.correlationId,
      requestId: crypto.randomUUID(),
    };
  }

  /**
   * Complete request tracking and save to database
   * @param context - Context from captureStart
   * @param input - Request completion data
   * @returns Promise with created log entry data
   */
  async captureEnd(context: LogContext, input: CaptureEndInput): Promise<LogEntryPublic> {
    if (input.requestData !== undefined || input.responseData !== undefined) {
      throw new Error('Telemetry sink input rejected');
    }
    const latencyMs = Date.now() - context.startTime;
    const attempts = input.attempts ?? 1;
    const provider = input.provider ?? context.provider;
    const model = input.model ?? context.model;

    const totalTokens = this.resolveTotalTokens(input);
    const failure = input.error ? normalizeTelemetryFailure(input.error) : undefined;
    const safeInput = parseRequestLogTelemetryInput({
      provider, model, totalTokens, inputTokens: input.inputTokens, outputTokens: input.outputTokens,
      cost: input.cost, latencyMs, ...(failure ? { errorCode: failure.code } : {}), attempts,
    });
    assertSafeTelemetryMetadata({ provider: safeInput.provider, model: safeInput.model,
      correlationId: context.correlationId, latencyMs: safeInput.latencyMs, attempts: safeInput.attempts },
    ['provider', 'model', 'correlationId', 'latencyMs', 'attempts']);
    const logEntry = {
      timestamp: context.startTime,
      provider,
      model,
      correlation_id: context.correlationId ?? null,
      total_tokens: totalTokens ?? null,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      cost: input.cost ?? null,
      latency_ms: latencyMs,
      error: failure?.code ?? null,
      error_code: failure?.code ?? null,
      error_category: failure?.category ?? null,
      attempts: safeInput.attempts ?? 1,
    };

    await this.enforceRetention();

    // Run database operation in a Promise for async behavior
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO request_logs (
            timestamp, provider, model, total_tokens, input_tokens, output_tokens,
            cost, latency_ms, error, error_code, error_category, attempts, correlation_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
          logEntry.timestamp,
          logEntry.provider,
          logEntry.model,
          logEntry.total_tokens,
          logEntry.input_tokens,
          logEntry.output_tokens,
          logEntry.cost,
          logEntry.latency_ms,
          logEntry.error,
          logEntry.error_code,
          logEntry.error_category,
          logEntry.attempts,
          logEntry.correlation_id
        );

        resolve({
          id: Number(result.lastInsertRowid),
          timestamp: logEntry.timestamp,
          provider: logEntry.provider,
          model: logEntry.model,
          correlationId: logEntry.correlation_id ?? undefined,
          totalTokens: this.normalizeOptionalNumber(logEntry.total_tokens),
          inputTokens: this.normalizeOptionalNumber(logEntry.input_tokens),
          outputTokens: this.normalizeOptionalNumber(logEntry.output_tokens),
          cost: this.normalizeOptionalNumber(logEntry.cost),
          latencyMs: logEntry.latency_ms,
          error: logEntry.error || undefined,
          attempts: logEntry.attempts,
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Capture a log entry directly (one-shot logging)
   * @param input - Direct capture input
   * @returns Promise with created log entry data
   */
  async capture(input: DirectCaptureInput): Promise<LogEntryPublic> {
    if (input.requestData !== undefined || input.responseData !== undefined) {
      throw new Error('Telemetry sink input rejected');
    }
    const failure = input.error ? normalizeTelemetryFailure(input.error) : undefined;
    const { error: _error, requestData: _requestData, responseData: _responseData, ...metadata } = input;
    const safeInput = parseRequestLogTelemetryInput({
      ...metadata,
      ...(failure ? { errorCode: failure.code } : {}),
    });
    assertSafeTelemetryMetadata({
      provider: safeInput.provider, model: safeInput.model, correlationId: safeInput.correlationId,
      totalTokens: safeInput.totalTokens, inputTokens: safeInput.inputTokens, outputTokens: safeInput.outputTokens,
      cost: safeInput.cost ?? undefined, latencyMs: safeInput.latencyMs, attempts: safeInput.attempts,
    }, ['provider', 'model', 'correlationId', 'totalTokens', 'inputTokens', 'outputTokens', 'cost', 'latencyMs', 'attempts']);
    const totalTokens = this.resolveTotalTokens(safeInput);
    const logEntry = {
      timestamp: Date.now(),
      provider: safeInput.provider,
      model: safeInput.model,
      correlation_id: safeInput.correlationId ?? null,
      total_tokens: totalTokens ?? null,
      input_tokens: safeInput.inputTokens ?? null,
      output_tokens: safeInput.outputTokens ?? null,
      cost: safeInput.cost ?? null,
      latency_ms: safeInput.latencyMs,
      error: failure?.code ?? null,
      error_code: failure?.code ?? null,
      error_category: failure?.category ?? null,
      attempts: safeInput.attempts ?? 1,
    };

    await this.enforceRetention();

    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO request_logs (
            timestamp, provider, model, total_tokens, input_tokens, output_tokens,
            cost, latency_ms, error, error_code, error_category, attempts, correlation_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
          logEntry.timestamp,
          logEntry.provider,
          logEntry.model,
          logEntry.total_tokens,
          logEntry.input_tokens,
          logEntry.output_tokens,
          logEntry.cost,
          logEntry.latency_ms,
          logEntry.error,
          logEntry.error_code,
          logEntry.error_category,
          logEntry.attempts,
          logEntry.correlation_id
        );

        resolve({
          id: Number(result.lastInsertRowid),
          timestamp: logEntry.timestamp,
          provider: logEntry.provider,
          model: logEntry.model,
          correlationId: logEntry.correlation_id ?? undefined,
          totalTokens: this.normalizeOptionalNumber(logEntry.total_tokens),
          inputTokens: this.normalizeOptionalNumber(logEntry.input_tokens),
          outputTokens: this.normalizeOptionalNumber(logEntry.output_tokens),
          cost: this.normalizeOptionalNumber(logEntry.cost),
          latencyMs: logEntry.latency_ms,
          error: logEntry.error || undefined,
          attempts: logEntry.attempts,
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Query logs with filtering and pagination
   * @param query - Query filters and pagination options
   * @returns Promise with logs and total count
   */
  async getLogs(query: LogQuery): Promise<LogsResponse> {
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    // Build WHERE clauses
    const whereConditions: string[] = [];
    const params: (string | number)[] = [];

    if (query.from !== undefined) {
      whereConditions.push('timestamp >= ?');
      params.push(query.from);
    }

    if (query.to !== undefined) {
      whereConditions.push('timestamp <= ?');
      params.push(query.to);
    }

    if (query.provider !== undefined) {
      whereConditions.push('provider = ?');
      params.push(query.provider);
    }

    if (query.model !== undefined) {
      whereConditions.push('model = ?');
      params.push(query.model);
    }

    if (query.correlationId !== undefined) {
      whereConditions.push('correlation_id = ?');
      params.push(query.correlationId);
    }

    if (query.status === LOG_QUERY_STATUS.FAILED) {
      whereConditions.push('error IS NOT NULL');
    }

    if (query.status === LOG_QUERY_STATUS.RETRIED) {
      whereConditions.push('error IS NULL');
      whereConditions.push('attempts > 1');
    }

    if (query.status === LOG_QUERY_STATUS.SUCCESSFUL) {
      whereConditions.push('error IS NULL');
      whereConditions.push('attempts = 1');
    }

    if (query.minLatencyMs !== undefined) {
      whereConditions.push('latency_ms >= ?');
      params.push(query.minLatencyMs);
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    return new Promise((resolve, reject) => {
      try {
        // Get total count
        const countSql = `SELECT COUNT(*) as count FROM request_logs ${whereClause}`;
        const countStmt = this.db.prepare(countSql);
        const countResult = countStmt.get(...params) as { count: number };
        const total = countResult.count;

        // Get paginated results
        const dataSql = `
          SELECT 
            id,
            timestamp,
            provider,
            model,
            correlation_id as correlationId,
            total_tokens as totalTokens,
            input_tokens as inputTokens,
            output_tokens as outputTokens,
            cost,
            latency_ms as latencyMs,
            error,
            attempts
          FROM request_logs
          ${whereClause}
          ORDER BY timestamp DESC
          LIMIT ? OFFSET ?
        `;

        const dataParams = [...params, limit, offset];
        const dataStmt = this.db.prepare(dataSql);
        const logs = dataStmt.all(...dataParams) as LogEntryPublic[];

        // Convert nullable columns to undefined for the public contract.
        const sanitizedLogs = logs.map(log => ({
          ...log,
          correlationId: log.correlationId || undefined,
          totalTokens: this.normalizeOptionalNumber(log.totalTokens),
          inputTokens: this.normalizeOptionalNumber(log.inputTokens),
          outputTokens: this.normalizeOptionalNumber(log.outputTokens),
          cost: this.normalizeOptionalNumber(log.cost),
          error: log.error || undefined,
        }));

        resolve({
          logs: sanitizedLogs,
          total,
          limit,
          offset,
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Delete old logs from the database
   * @param options - Cleanup options with age threshold
   * @returns Promise with number of deleted records
   */
  async cleanup(options: CleanupOptions): Promise<number> {
    const cutoffTimestamp = options.beforeTimestamp - (options.olderThanDays * 24 * 60 * 60 * 1000);

    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare(
          'DELETE FROM request_logs WHERE timestamp < ?'
        );
        const result = stmt.run(cutoffTimestamp);
        resolve(Number(result.changes));
      } catch (error) {
        reject(error);
      }
    });
  }

  async enforceRetention(beforeTimestamp = Date.now()): Promise<RetentionVerification> {
    await this.cleanup({ olderThanDays: 30, beforeTimestamp });
    const cutoff = beforeTimestamp - 30 * 24 * 60 * 60 * 1000;
    const remaining = this.db.prepare('SELECT COUNT(*) AS count FROM request_logs WHERE timestamp <= ?')
      .get(cutoff) as { count: number };
    return verifyRetention(RETENTION_SINKS.REQUEST_LOGS, { expiredRecordsAbsent: remaining.count === 0 });
  }
}

export default RequestLogger;
