/**
 * LatencyMeasurer — Background latency measurement for provider endpoints.
 *
 * Performs periodic HEAD requests to measure provider response times.
 * Measurements are cached with a 2-hour TTL for freshness.
 */

import type { LatencyMeasurement, ProviderConfig } from './types.js';

/** Default TTL for measurements in milliseconds (2 hours) */
export const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

/** Default background task interval in milliseconds (1 hour) */
export const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

/** Timeout for individual measurement requests in milliseconds */
export const MEASUREMENT_TIMEOUT_MS = 10_000;

/**
 * Measures latency to provider endpoints with caching and TTL management.
 */
export class LatencyMeasurer {
  private measurements: Map<string, LatencyMeasurement>;
  private readonly ttlMs: number;
  private intervalId: NodeJS.Timeout | null = null;

  /**
   * Create a new LatencyMeasurer.
   * @param ttlMs - Time-to-live for cached measurements (default: 2 hours)
   */
  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.measurements = new Map();
    this.ttlMs = ttlMs;
  }

  /**
   * Measure latency for a provider endpoint.
   * Performs a HEAD request and records the response time.
   * @param provider - Provider identifier
   * @param url - URL to measure
   * @returns Latency in milliseconds, or -1 if measurement failed
   */
  async measure(provider: string, url: string): Promise<number> {
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), MEASUREMENT_TIMEOUT_MS);

      await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        // Prevent following redirects to avoid measuring wrong endpoint
        redirect: 'manual',
      });

      clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;

      // Store the measurement
      const measurement: LatencyMeasurement = {
        provider,
        url,
        latencyMs,
        measuredAt: Date.now(),
      };

      this.measurements.set(provider, measurement);

      return latencyMs;
    } catch {
      // Measurement failed — store a failed marker with -1 latency
      const measurement: LatencyMeasurement = {
        provider,
        url,
        latencyMs: -1,
        measuredAt: Date.now(),
      };

      this.measurements.set(provider, measurement);

      return -1;
    }
  }

  /**
   * Get cached measurement for a provider.
   * Returns null if no measurement exists or if it has expired.
   * @param provider - Provider identifier
   * @returns The measurement or null
   */
  get(provider: string): LatencyMeasurement | null {
    const measurement = this.measurements.get(provider);

    if (!measurement) {
      return null;
    }

    // Check if measurement has expired
    if (Date.now() - measurement.measuredAt > this.ttlMs) {
      return null;
    }

    return measurement;
  }

  /**
   * Get all non-expired measurements.
   * @returns Array of latency measurements
   */
  getAll(): LatencyMeasurement[] {
    const now = Date.now();
    const result: LatencyMeasurement[] = [];

    for (const measurement of this.measurements.values()) {
      // Skip expired measurements
      if (now - measurement.measuredAt <= this.ttlMs) {
        result.push(measurement);
      }
    }

    return result;
  }

  /**
   * Remove expired measurements from the cache.
   * Call this periodically to prevent memory growth.
   */
  cleanup(): void {
    const now = Date.now();

    for (const [provider, measurement] of this.measurements.entries()) {
      if (now - measurement.measuredAt > this.ttlMs) {
        this.measurements.delete(provider);
      }
    }
  }

  /**
   * Start background measurement task.
   * Measures all providers every hour (configurable).
   * @param providers - Array of provider configurations to measure
   * @param intervalMs - Measurement interval in milliseconds (default: 1 hour)
   */
  startBackgroundTask(providers: ProviderConfig[], intervalMs: number = DEFAULT_INTERVAL_MS): void {
    // Clear any existing interval
    this.stopBackgroundTask();

    // Run initial measurement immediately
    void this.measureAll(providers);

    // Set up periodic measurements
    this.intervalId = setInterval(() => {
      void this.measureAll(providers);
    }, intervalMs);
  }

  /**
   * Stop the background measurement task.
   */
  stopBackgroundTask(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Measure all configured providers.
   * @param providers - Array of provider configurations
   */
  private async measureAll(providers: ProviderConfig[]): Promise<void> {
    for (const provider of providers) {
      if (provider.baseUrl) {
        await this.measure(provider.id, provider.baseUrl);
      }
    }
  }

  /**
   * Check if a measurement is stale (older than TTL).
   * @param provider - Provider identifier
   * @returns True if stale or not found
   */
  isStale(provider: string): boolean {
    const measurement = this.measurements.get(provider);

    if (!measurement) {
      return true;
    }

    return Date.now() - measurement.measuredAt > this.ttlMs;
  }

  /**
   * Get the number of cached measurements.
   * @returns Count of measurements (including expired)
   */
  size(): number {
    return this.measurements.size;
  }

  /**
   * Clear all measurements.
   */
  clear(): void {
    this.measurements.clear();
  }
}

/**
 * Create a LatencyMeasurer instance with default TTL.
 * @returns New LatencyMeasurer instance
 */
export function createLatencyMeasurer(): LatencyMeasurer {
  return new LatencyMeasurer();
}
