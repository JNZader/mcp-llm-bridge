/**
 * Type definitions for request logging
 * 
 * @module logging/types
 */

/**
 * Log entry for database storage
 */
export interface LogEntry {
  /** Primary key (auto-increment) */
  id?: number;
  
  /** Unix timestamp when request started */
  timestamp: number;
  
  /** Provider identifier (e.g., 'openai', 'anthropic', 'gemini-cli') */
  provider: string;
  
  /** Model name used */
  model: string;

  /** HTTP correlation ID associated with the request */
  correlationId?: string;
  
  /** Total tokens consumed when known exactly */
  totalTokens?: number;

  /** Input tokens consumed when known exactly */
  inputTokens?: number;
  
  /** Output tokens generated when known exactly */
  outputTokens?: number;
  
  /** Cost in currency units (e.g., USD) when known exactly */
  cost?: number;
  
  /** Total latency in milliseconds */
  latencyMs: number;
  
  /** Error message if request failed */
  error?: string;
  
  /** Number of retry attempts */
  attempts: number;
  
  /** Request payload (JSON string, may be truncated) */
  requestData?: string;
  
  /** Response payload (JSON string, may be truncated) */
  responseData?: string;
  
  /** Unix timestamp when log was created */
  createdAt?: number;
}

/**
 * Log entry for public API response (excludes sensitive data)
 */
export interface LogEntryPublic {
  /** Primary key */
  id: number;
  
  /** Unix timestamp when request started */
  timestamp: number;
  
  /** Provider identifier */
  provider: string;
  
  /** Model name */
  model: string;

  /** HTTP correlation ID associated with the request */
  correlationId?: string;
  
  /** Total tokens consumed when known exactly */
  totalTokens?: number;

  /** Input tokens when known exactly */
  inputTokens?: number;
  
  /** Output tokens when known exactly */
  outputTokens?: number;
  
  /** Cost in currency units when known exactly */
  cost?: number;
  
  /** Total latency in milliseconds */
  latencyMs: number;
  
  /** Error message if failed */
  error?: string;
  
  /** Number of attempts */
  attempts: number;
}

/**
 * Query parameters for GET /v1/logs
 */
export const LOG_QUERY_STATUS = {
  FAILED: 'failed',
  RETRIED: 'retried',
  SUCCESSFUL: 'successful',
} as const;

export type LogQueryStatus = (typeof LOG_QUERY_STATUS)[keyof typeof LOG_QUERY_STATUS];

export interface LogQuery {
  /** Start timestamp (Unix) - inclusive */
  from?: number;
  
  /** End timestamp (Unix) - inclusive */
  to?: number;
  
  /** Filter by provider */
  provider?: string;
  
  /** Filter by model */
  model?: string;

  /** Filter by HTTP correlation ID */
  correlationId?: string;

  /** Filter by incident-triage status */
  status?: LogQueryStatus;

  /** Filter by minimum latency in milliseconds */
  minLatencyMs?: number;
  
  /** Maximum results (default: 100, max: 1000) */
  limit?: number;
  
  /** Offset for pagination */
  offset?: number;
}

/**
 * Response structure for logs API
 */
export interface LogsResponse {
  /** Log entries */
  logs: LogEntryPublic[];
  
  /** Total matching records */
  total: number;
  
  /** Limit applied */
  limit: number;
  
  /** Offset applied */
  offset: number;
}

/**
 * Context for capturing request start
 * Used internally by the logging middleware
 */
export interface LogContext {
  /** Request start timestamp */
  startTime: number;
  
  /** Provider identifier */
  provider: string;
  
  /** Model name */
  model: string;

  /** HTTP correlation ID associated with the request */
  correlationId?: string;
  
  /** Request ID for correlation */
  requestId: string;
}

/**
 * Input for capturing request completion
 */
export interface LogCaptureInput {
  /** Context from request start */
  context: LogContext;
  
  /** Total tokens (if available) */
  totalTokens?: number;

  /** Input tokens (if available) */
  inputTokens?: number;
  
  /** Output tokens (if available) */
  outputTokens?: number;
  
  /** Cost calculation (if available) */
  cost?: number;
  
  /** Error if request failed */
  error?: Error;
  
  /** Number of retry attempts made */
  attempts: number;
  
  /** Request payload for debugging */
  requestData?: unknown;
  
  /** Response payload for debugging */
  responseData?: unknown;
}
