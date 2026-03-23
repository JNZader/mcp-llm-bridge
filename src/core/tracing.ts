/**
 * OpenTelemetry tracing setup for distributed tracing.
 * 
 * Traces are exported to OTLP-compatible collectors (Jaeger, Tempo, etc.)
 * via the OTLP HTTP exporter.
 * 
 * Enable with: LLM_GATEWAY_TRACING_ENABLED=true
 * Configure endpoint with: LLM_GATEWAY_OTLP_ENDPOINT=http://localhost:4318/v1/traces
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { trace, context, SpanStatusCode, Span } from '@opentelemetry/api';
import { VERSION } from './constants.js';

let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry tracing.
 * Safe to call multiple times - only initializes once.
 */
export function initTracing(): void {
  if (sdk) return;

  const enabled = process.env['LLM_GATEWAY_TRACING_ENABLED'] === 'true';
  if (!enabled) {
    return;
  }

  const endpoint = process.env['LLM_GATEWAY_OTLP_ENDPOINT'] ?? 'http://localhost:4318/v1/traces';

  const traceExporter = new OTLPTraceExporter({
    url: endpoint,
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: 'mcp-llm-bridge',
      [SEMRESATTRS_SERVICE_VERSION]: VERSION,
    }),
    traceExporter,
    instrumentations: [
      new HttpInstrumentation(),
      new PinoInstrumentation(),
    ],
  });

  sdk.start();

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await sdk?.shutdown();
  });
}

/**
 * Get the current tracer for the service.
 */
export function getTracer() {
  return trace.getTracer('mcp-llm-bridge', VERSION);
}

/**
 * Create a span for a provider generation call.
 */
export function startGenerateSpan(
  provider: string,
  model: string,
  project?: string,
): Span {
  const tracer = getTracer();
  return tracer.startSpan('llm.generate', {
    attributes: {
      'llm.provider': provider,
      'llm.model': model,
      'project': project ?? '_global',
    },
  });
}

/**
 * End a span with success.
 */
export function endSpanSuccess(span: Span, tokensUsed?: number): void {
  if (tokensUsed) {
    span.setAttribute('llm.tokens_used', tokensUsed);
  }
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

/**
 * End a span with error.
 */
export function endSpanError(span: Span, error: Error): void {
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  span.end();
}

/**
 * Run a function within a span context.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  const span = tracer.startSpan(name, { attributes });

  try {
    const result = await context.with(trace.setSpan(context.active(), span), () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    if (error instanceof Error) {
      endSpanError(span, error);
    }
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Shutdown tracing (call during graceful shutdown).
 */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}
