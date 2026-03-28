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
  
  /** Input tokens consumed */
  inputTokens: number;
  
  /** Output tokens generated */
  outputTokens: number;
  
  /** Cost in currency units (e.g., USD) */
  cost: number;
  
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
  
  /** Input tokens */
  inputTokens: number;
  
  /** Output tokens */
  outputTokens: number;
  
  /** Cost in currency units */
  cost: number;
  
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
export interface LogQuery {
  /** Start timestamp (Unix) - inclusive */
  from?: number;
  
  /** End timestamp (Unix) - inclusive */
  to?: number;
  
  /** Filter by provider */
  provider?: string;
  
  /** Filter by model */
  model?: string;
  
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
  
  /** Request ID for correlation */
  requestId: string;
}

/**
 * Input for capturing request completion
 */
export interface LogCaptureInput {
  /** Context from request start */
  context: LogContext;
  
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
