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
import { trace, context, SpanStatusCode, type Span } from '@opentelemetry/api';
import { VERSION } from './constants.js';
import { calculateCost } from './pricing.js';
import { getTracingOtlpEndpoint, isTracingEnabled } from './tracing-config.js';
import { assertSafeTelemetryMetadata } from '../telemetry/retention.js';
import { normalizeTelemetryFailure } from './telemetry-failure.js';
import {
  RETENTION_SINKS,
  RETENTION_VERIFICATION_OUTCOMES,
  enforceExternalRetention,
  type ExternalRetentionBackend,
} from '../telemetry/retention.js';

let sdk: NodeSDK | null = null;

export interface TracingOptions {
  retentionBackend?: ExternalRetentionBackend;
  createTraceExporter?: (endpoint: string) => OTLPTraceExporter;
}

/**
 * Initialize OpenTelemetry tracing.
 * Safe to call multiple times - only initializes once.
 */
export async function initTracing(options: TracingOptions = {}): Promise<boolean> {
  if (sdk) return true;

  if (!isTracingEnabled()) {
    return false;
  }

  const endpoint = getTracingOtlpEndpoint();
  const verification = await enforceExternalRetention(RETENTION_SINKS.TRACES, options.retentionBackend);
  if (verification.outcome !== RETENTION_VERIFICATION_OUTCOMES.SUCCESS) {
    return false;
  }

  const traceExporter = options.createTraceExporter?.(endpoint) ?? new OTLPTraceExporter({ url: endpoint });

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

  return true;
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
  _project?: string,
): Span {
  assertSafeTelemetryMetadata({ provider, model }, ['provider', 'model']);
  const tracer = getTracer();
  return tracer.startSpan('llm.generate', {
    attributes: {
      'llm.provider': provider,
      'llm.model': model,
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
  const failure = normalizeTelemetryFailure(error);
  span.setAttribute('telemetry.failure_code', failure.code);
  span.setAttribute('telemetry.failure_category', failure.category);
  span.setStatus({ code: SpanStatusCode.ERROR });
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
  assertSafeTelemetryMetadata(attributes, ['provider', 'model', 'status', 'code', 'category', 'route']);
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
 * GenAI semantic convention attributes for LLM generation spans.
 * Follows the emerging OTel GenAI semantic conventions:
 * https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */
export interface GenAISpanAttributes {
  'gen_ai.system': string;
  'gen_ai.request.model': string;
  'gen_ai.usage.input_tokens': number;
  'gen_ai.usage.output_tokens': number;
  'gen_ai.usage.cost'?: number;
  'gen_ai.response.finish_reason': string;
}

/**
 * Enrich an active span with OTel GenAI semantic convention attributes.
 *
 * Sets gen_ai.* attributes on the span for observability dashboards
 * that understand the GenAI conventions (e.g., Grafana, Datadog).
 *
 * Cost is computed via calculateCost(). Unknown models omit the
 * cost attribute and log a warning (handled inside calculateCost).
 *
 * @param span - The active OTel span to enrich
 * @param attrs - GenAI attributes to set
 */
export function enrichGenerateSpan(span: Span, attrs: GenAISpanAttributes): void {
  const safe = assertSafeTelemetryMetadata({
    provider: attrs['gen_ai.system'],
    model: attrs['gen_ai.request.model'],
    inputTokens: attrs['gen_ai.usage.input_tokens'],
    outputTokens: attrs['gen_ai.usage.output_tokens'],
    cost: attrs['gen_ai.usage.cost'],
    finishReason: attrs['gen_ai.response.finish_reason'],
  }, ['provider', 'model', 'inputTokens', 'outputTokens', 'cost', 'finishReason']);
  span.setAttribute('gen_ai.system', safe.provider as string);
  span.setAttribute('gen_ai.request.model', safe.model as string);
  span.setAttribute('gen_ai.usage.input_tokens', safe.inputTokens as number);
  span.setAttribute('gen_ai.usage.output_tokens', safe.outputTokens as number);
  if (typeof safe.cost === 'number') {
    span.setAttribute('gen_ai.usage.cost', safe.cost);
  }
  span.setAttribute('gen_ai.response.finish_reason', safe.finishReason as string);
}

/**
 * Build GenAISpanAttributes from usage data and enrich the span.
 *
 * Convenience wrapper that computes cost from model + tokens
 * and maps success/error to finish_reason before calling enrichGenerateSpan().
 *
 * @param span - The active OTel span to enrich
 * @param provider - Provider name (e.g., "openai", "anthropic")
 * @param model - Model name (e.g., "gpt-4o", "claude-3.5-sonnet")
 * @param tokensIn - Input/prompt token count
 * @param tokensOut - Output/completion token count
 * @param success - Whether the generation succeeded
 */
export function enrichGenerateSpanFromUsage(
  span: Span,
  provider: string,
  model: string,
  tokensIn: number,
  tokensOut: number,
  success: boolean,
): void {
  const cost = calculateCost(model, tokensIn, tokensOut);

  enrichGenerateSpan(span, {
    'gen_ai.system': provider,
    'gen_ai.request.model': model,
    'gen_ai.usage.input_tokens': tokensIn,
    'gen_ai.usage.output_tokens': tokensOut,
    ...(cost === null ? {} : { 'gen_ai.usage.cost': cost }),
    'gen_ai.response.finish_reason': success ? 'stop' : 'error',
  });
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
