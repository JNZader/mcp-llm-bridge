/**
 * Analytics Aggregator Implementation
 *
 * In-memory aggregation of LLM request metrics across multiple dimensions:
 * - total: aggregate of all requests
 * - hourly: grouped by hour
 * - daily: grouped by day
 * - channel: grouped by channel ID
 * - model: grouped by model name
 *
 * Features:
 * - Sliding window for latency percentiles (p95, p99)
 * - Efficient memory usage (no raw data storage)
 * - Periodic flush to database
 *
 * Following the specification from openspec/changes/octopus-features/tasks.md
 * Tasks 2.2.1, 2.2.2: Analytics aggregator implementation
 */

import type {
  AnalyticsMetrics,
  AnalyticsDimensions,
  AggregatedDataPoint,
  AnalyticsQuery,
  RecordInput,
  AggregatorConfig,
  AnalyticsPersistenceData,
  AnalyticsPersistenceWriter,
} from './types.js';

const DEFAULT_FLUSH_INTERVAL_MS = 5000;

/**
 * AnalyticsAggregator - In-memory metrics aggregation
 *
 * Thread-safe for single-threaded Node.js environment
 * Uses sliding window for latency percentiles
 */
export class AnalyticsAggregator {
  private dimensions: AnalyticsDimensions;
  private maxLatencyWindow: number;
  private persistenceWriter?: AnalyticsPersistenceWriter;
  private flushInterval?: ReturnType<typeof setInterval>;
  private flushPromise?: Promise<void>;
  private revision = 0;
  private lastFlushedRevision = 0;

  /**
   * Create a new AnalyticsAggregator
   * @param config Optional configuration
   */
  constructor(config: AggregatorConfig = {}) {
    this.maxLatencyWindow = config.maxLatencyWindow ?? 1000;
    this.persistenceWriter = config.persistenceWriter;
    this.dimensions = {
      total: this.createEmptyMetrics(),
      hourly: new Map(),
      daily: new Map(),
      channel: new Map(),
      provider: new Map(),
      model: new Map(),
    };

    if (this.persistenceWriter) {
      this.flushInterval = setInterval(() => {
        void this.flush().catch(() => {});
      }, config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
      this.flushInterval.unref();
    }
  }

  /**
   * Record a request with metrics
   * Updates all relevant dimensions
   *
   * @param provider - The provider that served the request (e.g., 'openai', 'anthropic')
   * @param model - The model used (e.g., 'gpt-4o', 'claude-3-opus')
   * @param metrics - Request metrics
   */
  record(
    provider: string,
    model: string,
    metrics: RecordInput
  ): void {
    this.revision += 1;
    const timestamp = metrics.timestamp ?? Date.now();

    // Update total dimension
    this.updateMetrics(this.dimensions.total, metrics);

    // Update hourly dimension
    const hourTimestamp = this.getHourTimestamp(timestamp);
    const hourlyMetrics = this.getOrCreateMetrics(this.dimensions.hourly, hourTimestamp);
    this.updateMetrics(hourlyMetrics, metrics);

    // Update daily dimension
    const dayTimestamp = this.getDayTimestamp(timestamp);
    const dailyMetrics = this.getOrCreateMetrics(this.dimensions.daily, dayTimestamp);
    this.updateMetrics(dailyMetrics, metrics);

    // Update channel dimension
    const channelMetrics = this.getOrCreateMetrics(
      this.dimensions.channel,
      metrics.channel
    );
    this.updateMetrics(channelMetrics, metrics);

    // Update provider dimension
    const providerMetrics = this.getOrCreateMetrics(this.dimensions.provider, provider);
    this.updateMetrics(providerMetrics, metrics);

    // Update model dimension
    const modelMetrics = this.getOrCreateMetrics(this.dimensions.model, model);
    this.updateMetrics(modelMetrics, metrics);
  }

  /**
   * Query aggregated data by dimension
   *
   * @param query - Query parameters
   * @returns Array of aggregated data points
   */
  query(query: AnalyticsQuery): AggregatedDataPoint[] {
    const { dimension, from, to, channelId, provider: providerFilter, model: modelFilter } = query;

    switch (dimension) {
      case 'total':
        return [this.toDataPoint(0, this.dimensions.total)];

      case 'hourly':
        return this.queryTimeDimension(
          this.dimensions.hourly,
          from,
          to
        );

      case 'daily':
        return this.queryTimeDimension(
          this.dimensions.daily,
          from,
          to
        );

      case 'channel':
        if (channelId) {
          // Query specific channel
          const metrics = this.dimensions.channel.get(channelId);
          return metrics ? [this.toDataPoint(0, metrics, { channelId })] : [];
        }
        // Return all channels
        return Array.from(this.dimensions.channel.entries()).map(
          ([id, metrics]) => this.toDataPoint(0, metrics, { channelId: id })
        );

      case 'provider':
        if (providerFilter) {
          const metrics = this.dimensions.provider.get(providerFilter);
          return metrics ? [this.toDataPoint(0, metrics, { provider: providerFilter })] : [];
        }
        return Array.from(this.dimensions.provider.entries()).map(
          ([name, metrics]) => this.toDataPoint(0, metrics, { provider: name })
        );

      case 'model':
        if (modelFilter) {
          // Query specific model
          const metrics = this.dimensions.model.get(modelFilter);
          return metrics ? [this.toDataPoint(0, metrics, { model: modelFilter })] : [];
        }
        // Return all models
        return Array.from(this.dimensions.model.entries()).map(
          ([name, metrics]) => this.toDataPoint(0, metrics, { model: name })
        );

      default:
        return [];
    }
  }

  /**
   * Flush durable hourly/daily aggregates to the configured writer.
   *
   * The in-memory read path stays intact; persisted data is an absolute snapshot,
   * so successful flushes do not clear live state.
   *
   * @param writer - Optional writer override for tests/manual flushes
   */
  async flush(writer: AnalyticsPersistenceWriter | undefined = this.persistenceWriter): Promise<void> {
    if (!writer) {
      return;
    }

    if (this.lastFlushedRevision === this.revision) {
      return;
    }

    if (this.flushPromise) {
      return this.flushPromise;
    }

    const targetRevision = this.revision;
    const flushData = this.preparePersistenceData();
    if (flushData.hourly.length === 0 && flushData.daily.length === 0) {
      this.lastFlushedRevision = targetRevision;
      return;
    }

    this.flushPromise = Promise.resolve(writer.upsert(flushData))
      .then(() => {
        this.lastFlushedRevision = targetRevision;
      })
      .finally(() => {
        this.flushPromise = undefined;
      });

    return this.flushPromise;
  }

  /**
   * Stop periodic flushes and persist remaining durable aggregates.
   */
  async destroy(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = undefined;
    }

    if (!this.persistenceWriter) {
      return;
    }

    while (this.lastFlushedRevision < this.revision) {
      await this.flush();
    }
  }

  /**
   * Clear all in-memory aggregated data
   */
  clear(): void {
    this.dimensions.total = this.createEmptyMetrics();
    this.dimensions.hourly.clear();
    this.dimensions.daily.clear();
    this.dimensions.channel.clear();
    this.dimensions.provider.clear();
    this.dimensions.model.clear();
    this.revision += 1;
    this.lastFlushedRevision = this.revision;
  }

  // Private helper methods

  /**
   * Create empty metrics object
   */
  private createEmptyMetrics(): AnalyticsMetrics {
    return {
      requests: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      totalLatencyMs: 0,
      latencies: [],
    };
  }

  /**
   * Get metrics from map or create if doesn't exist
   */
  private getOrCreateMetrics<K>(
    map: Map<K, AnalyticsMetrics>,
    key: K
  ): AnalyticsMetrics {
    let metrics = map.get(key);
    if (!metrics) {
      metrics = this.createEmptyMetrics();
      map.set(key, metrics);
    }
    return metrics;
  }

  /**
   * Update metrics with new request data
   */
  private updateMetrics(
    metrics: AnalyticsMetrics,
    data: RecordInput
  ): void {
    const totalTokens = typeof data.totalTokens === 'number'
      ? data.totalTokens
      : typeof data.inputTokens === 'number' && typeof data.outputTokens === 'number'
        ? data.inputTokens + data.outputTokens
        : 0;

    metrics.requests += 1;
    metrics.totalTokens += totalTokens;
    metrics.inputTokens += data.inputTokens ?? 0;
    metrics.outputTokens += data.outputTokens ?? 0;
    metrics.cost += data.cost ?? 0;
    metrics.totalLatencyMs += data.latencyMs;

    // Add to sliding window
    metrics.latencies.push(data.latencyMs);

    // Trim if exceeds max window
    if (metrics.latencies.length > this.maxLatencyWindow) {
      metrics.latencies = metrics.latencies.slice(-this.maxLatencyWindow);
    }
  }

  /**
   * Get hour timestamp (floored to hour boundary)
   */
  private getHourTimestamp(timestamp: number): number {
    const date = new Date(timestamp);
    date.setMinutes(0, 0, 0);
    return date.getTime();
  }

  /**
   * Get day timestamp (floored to day boundary)
   */
  private getDayTimestamp(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  /**
   * Convert metrics to AggregatedDataPoint
   */
  private toDataPoint(
    timestamp: number,
    metrics: AnalyticsMetrics,
    identifiers?: {
      channelId?: string;
      provider?: string;
      model?: string;
    }
  ): AggregatedDataPoint {
    const avgLatency =
      metrics.requests > 0
        ? Math.round(metrics.totalLatencyMs / metrics.requests)
        : 0;

    const result: AggregatedDataPoint = {
      timestamp,
      ...(identifiers?.channelId ? { channelId: identifiers.channelId } : {}),
      ...(identifiers?.provider ? { provider: identifiers.provider } : {}),
      ...(identifiers?.model ? { model: identifiers.model } : {}),
      requests: metrics.requests,
      totalTokens: metrics.totalTokens,
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
      cost: Math.round(metrics.cost * 1000000) / 1000000, // Round to 6 decimals
      avgLatency,
    };

    // Calculate percentiles if we have enough samples
    if (metrics.latencies.length >= 10) {
      const percentiles = this.calculatePercentiles(metrics.latencies);
      result.p95Latency = percentiles.p95;
      result.p99Latency = percentiles.p99;
    }

    return result;
  }

  /**
   * Query time-based dimension (hourly or daily)
   */
  private queryTimeDimension(
    map: Map<number, AnalyticsMetrics>,
    from?: number,
    to?: number
  ): AggregatedDataPoint[] {
    const results: AggregatedDataPoint[] = [];

    for (const [timestamp, metrics] of map.entries()) {
      // Apply time filters
      if (from !== undefined && timestamp < from) continue;
      if (to !== undefined && timestamp > to) continue;

      results.push(this.toDataPoint(timestamp, metrics));
    }

    // Sort by timestamp ascending
    return results.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Calculate p95 and p99 percentiles from latency array
   */
  private calculatePercentiles(latencies: number[]): { p95: number; p99: number } {
    // Sort latencies
    const sorted = [...latencies].sort((a, b) => a - b);
    const n = sorted.length;

    // Calculate percentile indices (using linear interpolation)
    const p95Index = (n - 1) * 0.95;
    const p99Index = (n - 1) * 0.99;

    return {
      p95: this.interpolatePercentile(sorted, p95Index),
      p99: this.interpolatePercentile(sorted, p99Index),
    };
  }

  /**
   * Interpolate percentile value from sorted array
   */
  private interpolatePercentile(sorted: number[], index: number): number {
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    if (upper >= sorted.length) {
      return sorted[sorted.length - 1]!;
    }

    return Math.round(sorted[lower]! * (1 - weight) + sorted[upper]! * weight);
  }

  /**
   * Prepare the durable subset that is safe to upsert repeatedly.
   */
  private preparePersistenceData(): AnalyticsPersistenceData {
    return {
      flushedAt: Date.now(),
      hourly: Array.from(this.dimensions.hourly.entries()).map(
        ([timestamp, metrics]) => ({
          timestamp,
          data: this.toDataPoint(timestamp, metrics),
        })
      ),
      daily: Array.from(this.dimensions.daily.entries()).map(
        ([timestamp, metrics]) => ({
          timestamp,
          data: this.toDataPoint(timestamp, metrics),
        })
      ),
    };
  }
}
