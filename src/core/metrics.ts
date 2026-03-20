/**
 * Prometheus metrics for observability.
 * 
 * Exposes metrics at /metrics endpoint for Prometheus scraping.
 * 
 * Metrics:
 * - http_requests_total: Counter of HTTP requests by method, path, status
 * - http_request_duration_seconds: Histogram of request durations
 * - llm_requests_total: Counter of LLM requests by provider, model, status
 * - llm_request_duration_seconds: Histogram of LLM request durations
 * - llm_tokens_used_total: Counter of tokens used by provider, model
 * - vault_operations_total: Counter of vault operations by type, status
 * - provider_available: Gauge of provider availability (1=yes, 0=no)
 */

import { Counter, Histogram, Gauge, collectDefaultMetrics, register } from 'prom-client';
import { Router } from './router.js';

// HTTP metrics
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

// LLM metrics
export const llmRequestsTotal = new Counter({
  name: 'llm_requests_total',
  help: 'Total number of LLM requests',
  labelNames: ['provider', 'model', 'status'],
});

export const llmRequestDuration = new Histogram({
  name: 'llm_request_duration_seconds',
  help: 'LLM request duration in seconds',
  labelNames: ['provider', 'model'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
});

export const llmTokensUsedTotal = new Counter({
  name: 'llm_tokens_used_total',
  help: 'Total number of tokens used',
  labelNames: ['provider', 'model'],
});

// Vault metrics
export const vaultOperationsTotal = new Counter({
  name: 'vault_operations_total',
  help: 'Total number of vault operations',
  labelNames: ['operation', 'status'],
});

// Provider availability
export const providerAvailable = new Gauge({
  name: 'provider_available',
  help: 'Provider availability (1=available, 0=unavailable)',
  labelNames: ['provider'],
});

/**
 * Initialize metrics collection.
 * Call once at startup.
 */
export function initMetrics(): void {
  // Collect default Node.js metrics (memory, CPU, event loop, etc.)
  collectDefaultMetrics({
    prefix: 'mcp_llm_bridge_',
  });
}

/**
 * Get metrics in Prometheus format.
 */
export async function getMetrics(): Promise<string> {
  return register.metrics();
}

/**
 * Get content type for metrics endpoint.
 */
export function getMetricsContentType(): string {
  return register.contentType;
}

/**
 * Update provider availability gauges.
 * Call periodically to reflect current state.
 */
export async function updateProviderAvailability(router: Router): Promise<void> {
  const statuses = await router.getProviderStatuses();
  for (const status of statuses) {
    providerAvailable.set({ provider: status.id }, status.available ? 1 : 0);
  }
}

/**
 * Start timing an LLM request.
 * Returns a function to call on completion.
 */
export function startLlmTimer(provider: string, model: string): () => void {
  const end = llmRequestDuration.startTimer({ provider, model });
  return end;
}

/**
 * Start timing an HTTP request.
 * Returns a function to call on completion with status.
 */
export function startHttpTimer(method: string, path: string): (status: number) => void {
  const end = httpRequestDuration.startTimer({ method, path });
  return (status: number) => {
    end();
    httpRequestsTotal.inc({ method, path, status: Math.floor(status / 100).toString() + 'xx' });
  };
}
