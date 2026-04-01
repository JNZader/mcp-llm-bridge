/**
 * Free Model Health Checker — pings endpoints to verify availability.
 *
 * Sends lightweight HTTP requests to free model endpoints, measuring
 * latency and tracking availability over time. Runs periodic checks
 * on a configurable interval.
 */

import { logger } from '../core/logger.js';
import type { FreeModelEntry, HealthCheckResult, HealthStatus } from './types.js';

/**
 * Perform a single health check against a free model endpoint.
 *
 * Sends a minimal chat completion request (or a HEAD/GET to the
 * models endpoint) to verify the endpoint is responsive.
 */
export async function checkHealth(
  entry: FreeModelEntry,
  timeoutMs: number = 5000,
): Promise<HealthCheckResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Resolve API key from environment if specified
    const apiKey = entry.apiKeyEnv ? process.env[entry.apiKeyEnv] : undefined;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // Use the models list endpoint as a lightweight health probe
    const url = `${entry.baseUrl}/models`;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    const latencyMs = Date.now() - start;

    let status: HealthStatus;
    if (response.ok) {
      status = 'healthy';
    } else if (response.status === 429) {
      status = 'degraded'; // Rate-limited but alive
    } else {
      status = 'down';
    }

    return {
      modelId: entry.id,
      status,
      latencyMs,
      lastChecked: new Date().toISOString(),
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = message.includes('abort');

    return {
      modelId: entry.id,
      status: 'down',
      latencyMs: isTimeout ? null : latencyMs,
      lastChecked: new Date().toISOString(),
      error: isTimeout ? `Timeout after ${timeoutMs}ms` : message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HealthChecker — manages periodic health probes for free model endpoints.
 *
 * Maintains an in-memory cache of health results and refreshes them
 * at a configurable interval. Reliability is tracked as a rolling
 * success rate over the last N checks.
 */
export class HealthChecker {
  private results: Map<string, HealthCheckResult> = new Map();
  private successHistory: Map<string, boolean[]> = new Map();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly historySize = 10;

  constructor(
    private readonly timeoutMs: number = 5000,
  ) {}

  /** Get the latest health result for a model. */
  getHealth(modelId: string): HealthCheckResult | undefined {
    return this.results.get(modelId);
  }

  /** Get all cached health results. */
  getAllHealth(): Map<string, HealthCheckResult> {
    return new Map(this.results);
  }

  /**
   * Get the reliability score for a model (0-1).
   * Based on the rolling success rate over the last N checks.
   * Returns 0.5 if no history (unknown models get neutral score).
   */
  getReliability(modelId: string): number {
    const history = this.successHistory.get(modelId);
    if (!history || history.length === 0) return 0.5;

    const successes = history.filter(Boolean).length;
    return successes / history.length;
  }

  /**
   * Check health for a batch of models.
   * Runs checks in parallel for efficiency.
   */
  async checkAll(entries: FreeModelEntry[]): Promise<HealthCheckResult[]> {
    const results = await Promise.all(
      entries.map((entry) => checkHealth(entry, this.timeoutMs)),
    );

    for (const result of results) {
      this.results.set(result.modelId, result);
      this.recordHistory(result.modelId, result.status === 'healthy' || result.status === 'degraded');
    }

    return results;
  }

  /**
   * Start periodic health checks.
   * @param entries Models to check
   * @param intervalSec Check interval in seconds
   */
  startPeriodicChecks(entries: FreeModelEntry[], intervalSec: number): void {
    this.stopPeriodicChecks();

    // Run immediately, then on interval
    void this.checkAll(entries).catch((error) => {
      logger.warn({ error }, 'Free model health check failed');
    });

    this.intervalHandle = setInterval(() => {
      void this.checkAll(entries).catch((error) => {
        logger.warn({ error }, 'Free model periodic health check failed');
      });
    }, intervalSec * 1000);

    // Prevent interval from keeping the process alive
    if (this.intervalHandle && typeof this.intervalHandle === 'object' && 'unref' in this.intervalHandle) {
      this.intervalHandle.unref();
    }
  }

  /** Stop periodic health checks. */
  stopPeriodicChecks(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Clean up resources. */
  destroy(): void {
    this.stopPeriodicChecks();
    this.results.clear();
    this.successHistory.clear();
  }

  /** Record a success/failure entry in rolling history. */
  private recordHistory(modelId: string, success: boolean): void {
    let history = this.successHistory.get(modelId);
    if (!history) {
      history = [];
      this.successHistory.set(modelId, history);
    }

    history.push(success);

    // Trim to historySize
    if (history.length > this.historySize) {
      history.splice(0, history.length - this.historySize);
    }
  }
}
