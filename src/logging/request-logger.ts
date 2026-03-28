/**
 * RequestLogger - SQLite-based request logging
 * 
 * Implements non-blocking async logging with automatic truncation
 * of large payloads. Supports querying with filters and cleanup.
 * 
 * @module logging/request-logger
 */

import type Database from 'better-sqlite3';
import type { LogContext, LogQuery, LogsResponse, LogEntryPublic } from './types.js';

/**
 * Input for capture method (direct logging)
 */
export interface DirectCaptureInput {
  provider: string;
  model: string;
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
  startTime?: number;
}

/**
 * Input for captureEnd method
 */
export interface CaptureEndInput {
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  error?: Error;
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

  /**
   * Create a new RequestLogger instance
   * @param db - better-sqlite3 Database instance
   */
  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Truncate string to max length
   * @param str - String to truncate
   * @param maxLength - Maximum length (default 10000)
   * @returns Truncated string
   */
  private truncate(str: string | undefined, maxLength = 10000): string | undefined {
    if (!str) return undefined;
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength);
  }

  /**
   * Serialize unknown data to JSON string with truncation
   * @param data - Data to serialize
   * @returns JSON string or undefined
   */
  private serializeData(data: unknown): string | undefined {
    if (data === undefined || data === null) return undefined;
    if (typeof data === 'string') return this.truncate(data);
    try {
      return this.truncate(JSON.stringify(data));
    } catch {
      return undefined;
    }
  }

  /**
   * Start request tracking
   * @param input - Provider and model information, optionally with startTime
   * @returns LogContext with timing and request ID
   */
  captureStart(input: CaptureStartInput): LogContext {
    return {
      startTime: input.startTime ?? Date.now(),
      provider: input.provider,
      model: input.model,
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
    const latencyMs = Date.now() - context.startTime;
    const attempts = 1; // Default attempts

    const logEntry = {
      timestamp: context.startTime,
      provider: context.provider,
      model: context.model,
      input_tokens: input.inputTokens || 0,
      output_tokens: input.outputTokens || 0,
      cost: input.cost || 0,
      latency_ms: latencyMs,
      error: input.error?.message || null,
      attempts,
      request_data: this.serializeData(input.requestData),
      response_data: this.serializeData(input.responseData),
    };

    // Run database operation in a Promise for async behavior
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO request_logs (
            timestamp, provider, model, input_tokens, output_tokens,
            cost, latency_ms, error, attempts, request_data, response_data
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
          logEntry.timestamp,
          logEntry.provider,
          logEntry.model,
          logEntry.input_tokens,
          logEntry.output_tokens,
          logEntry.cost,
          logEntry.latency_ms,
          logEntry.error,
          logEntry.attempts,
          logEntry.request_data ?? null,
          logEntry.response_data ?? null
        );

        resolve({
          id: Number(result.lastInsertRowid),
          timestamp: logEntry.timestamp,
          provider: logEntry.provider,
          model: logEntry.model,
          inputTokens: logEntry.input_tokens,
          outputTokens: logEntry.output_tokens,
          cost: logEntry.cost,
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
    const logEntry = {
      timestamp: Date.now(),
      provider: input.provider,
      model: input.model,
      input_tokens: input.inputTokens || 0,
      output_tokens: input.outputTokens || 0,
      cost: input.cost || 0,
      latency_ms: input.latencyMs,
      error: input.error || null,
      attempts: input.attempts || 1,
      request_data: this.truncate(input.requestData) ?? null,
      response_data: this.truncate(input.responseData) ?? null,
    };

    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO request_logs (
            timestamp, provider, model, input_tokens, output_tokens,
            cost, latency_ms, error, attempts, request_data, response_data
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
          logEntry.timestamp,
          logEntry.provider,
          logEntry.model,
          logEntry.input_tokens,
          logEntry.output_tokens,
          logEntry.cost,
          logEntry.latency_ms,
          logEntry.error,
          logEntry.attempts,
          logEntry.request_data,
          logEntry.response_data
        );

        resolve({
          id: Number(result.lastInsertRowid),
          timestamp: logEntry.timestamp,
          provider: logEntry.provider,
          model: logEntry.model,
          inputTokens: logEntry.input_tokens,
          outputTokens: logEntry.output_tokens,
          cost: logEntry.cost,
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

        // Convert null errors to undefined
        const sanitizedLogs = logs.map(log => ({
          ...log,
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
}

export default RequestLogger;
