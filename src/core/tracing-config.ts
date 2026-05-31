const DEFAULT_OTLP_TRACES_ENDPOINT = 'http://localhost:4318/v1/traces';

export function isTracingEnabled(env = process.env): boolean {
  return env['LLM_GATEWAY_TRACING_ENABLED'] === 'true';
}

export function getTracingOtlpEndpoint(env = process.env): string {
  return env['LLM_GATEWAY_OTLP_ENDPOINT'] ?? DEFAULT_OTLP_TRACES_ENDPOINT;
}
