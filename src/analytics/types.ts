/**
 * TypeScript interfaces for Analytics Aggregator
 *
 * Following the specification from openspec/changes/octopus-features/tasks.md
 * Task 2.2.1: Define TypeScript Interfaces for Analytics
 */

/**
 * Core metrics tracked for each dimension
 */
export interface AnalyticsMetrics {
  /** Number of requests */
  requests: number;
  /** Total input tokens across all requests */
  inputTokens: number;
  /** Total output tokens across all requests */
  outputTokens: number;
  /** Total cost in USD */
  cost: number;
  /** Total latency in milliseconds (for calculating average) */
  totalLatencyMs: number;
  /** Sliding window of individual latencies (for p95/p99 calculation) */
  latencies: number[];
}

/**
 * Analytics data organized by different dimensions
 */
export interface AnalyticsDimensions {
  /** Total aggregated metrics across all requests */
  total: AnalyticsMetrics;
  /** Hourly aggregated metrics: hour timestamp -> metrics */
  hourly: Map<number, AnalyticsMetrics>;
  /** Daily aggregated metrics: day timestamp -> metrics */
  daily: Map<number, AnalyticsMetrics>;
  /** Per-channel metrics: channel_id -> metrics */
  channel: Map<string, AnalyticsMetrics>;
  /** Per-model metrics: model name -> metrics */
  model: Map<string, AnalyticsMetrics>;
}

/**
 * Single aggregated data point returned from queries
 */
export interface AggregatedDataPoint {
  /** Timestamp for this data point (unix timestamp in ms) */
  timestamp: number;
  /** Number of requests */
  requests: number;
  /** Total input tokens */
  inputTokens: number;
  /** Total output tokens */
  outputTokens: number;
  /** Total cost in USD */
  cost: number;
  /** Average latency in milliseconds */
  avgLatency: number;
  /** 95th percentile latency (optional, requires sufficient samples) */
  p95Latency?: number;
  /** 99th percentile latency (optional, requires sufficient samples) */
  p99Latency?: number;
}

/**
 * Query parameters for retrieving aggregated analytics
 */
export interface AnalyticsQuery {
  /** Dimension to query: total, hourly, daily, channel, or model */
  dimension: 'total' | 'hourly' | 'daily' | 'channel' | 'model';
  /** Start of time range (unix timestamp in ms, inclusive) */
  from?: number;
  /** End of time range (unix timestamp in ms, inclusive) */
  to?: number;
  /** Filter by channel ID (required when dimension is 'channel') */
  channelId?: string;
  /** Filter by model name (required when dimension is 'model') */
  model?: string;
}

/**
 * Input data for recording a request
 */
export interface RecordInput {
  /** Number of input tokens */
  inputTokens: number;
  /** Number of output tokens */
  outputTokens: number;
  /** Cost in USD */
  cost: number;
  /** Latency in milliseconds */
  latencyMs: number;
  /** Channel ID (required for channel dimension tracking) */
  channel: string;
  /** Optional timestamp (defaults to current time) */
  timestamp?: number;
}

/**
 * Configuration options for AnalyticsAggregator
 */
export interface AggregatorConfig {
  /** Maximum number of latencies to keep in sliding window (default: 1000) */
  maxLatencyWindow?: number;
}

/**
 * Database interface for flush operations
 * Minimal interface that any database adapter can implement
 */
export interface Database {
  /** Analytics table/collection operations */
  analytics: {
    /** Insert analytics data */
    insert: (data: AnalyticsFlushData) => Promise<void>;
    /** Query analytics data (used for verification) */
    query: (sql: string, params: unknown[]) => Promise<unknown[]>;
  };
}

/**
 * Data structure flushed to database
 */
export interface AnalyticsFlushData {
  /** Timestamp when flush occurred */
  flushedAt: number;
  /** Total metrics */
  total: AggregatedDataPoint;
  /** Hourly metrics array */
  hourly: Array<{ timestamp: number; data: AggregatedDataPoint }>;
  /** Daily metrics array */
  daily: Array<{ timestamp: number; data: AggregatedDataPoint }>;
  /** Per-channel metrics array */
  channel: Array<{ id: string; data: AggregatedDataPoint }>;
  /** Per-model metrics array */
  model: Array<{ name: string; data: AggregatedDataPoint }>;
}

// Type guards for runtime type checking

/**
 * Check if a value is a valid AnalyticsMetrics object
 */
export function isAnalyticsMetrics(value: unknown): value is AnalyticsMetrics {
  if (typeof value !== 'object' || value === null) return false;
  const metrics = value as Partial<AnalyticsMetrics>;

  return (
    typeof metrics.requests === 'number' &&
    typeof metrics.inputTokens === 'number' &&
    typeof metrics.outputTokens === 'number' &&
    typeof metrics.cost === 'number' &&
    typeof metrics.totalLatencyMs === 'number' &&
    Array.isArray(metrics.latencies)
  );
}

/**
 * Check if a value is a valid AnalyticsQuery
 */
export function isAnalyticsQuery(value: unknown): value is AnalyticsQuery {
  if (typeof value !== 'object' || value === null) return false;
  const query = value as Partial<AnalyticsQuery>;

  // Check required dimension field
  if (!query.dimension) return false;
  if (!['total', 'hourly', 'daily', 'channel', 'model'].includes(query.dimension)) {
    return false;
  }

  // Check optional fields have correct types
  if (query.from !== undefined && typeof query.from !== 'number') return false;
  if (query.to !== undefined && typeof query.to !== 'number') return false;
  if (query.channelId !== undefined && typeof query.channelId !== 'string') return false;
  if (query.model !== undefined && typeof query.model !== 'string') return false;

  return true;
}

/**
 * Check if a value is a valid AggregatedDataPoint
 */
export function isAggregatedDataPoint(value: unknown): value is AggregatedDataPoint {
  if (typeof value !== 'object' || value === null) return false;
  const point = value as Partial<AggregatedDataPoint>;

  return (
    typeof point.timestamp === 'number' &&
    typeof point.requests === 'number' &&
    typeof point.inputTokens === 'number' &&
    typeof point.outputTokens === 'number' &&
    typeof point.cost === 'number' &&
    typeof point.avgLatency === 'number'
  );
}
