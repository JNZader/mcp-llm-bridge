import type { GenerateRequest, LLMProvider } from './types.js';
import type { InternalLLMRequest, InternalLLMResponse } from './internal-model.js';
import type { TransformerRegistry } from './transformer.js';
import type { TaskClassification } from '../classification/index.js';
import type { ModelEndpoint } from '../model-routing/types.js';
import type { CircuitBreakerV2 } from '../circuit-breaker/circuit-breaker-v2.js';
import { logger } from './logger.js';

type RecordUsageFn = (
  provider: string,
  model: string,
  tokensIn: number,
  tokensOut: number,
  latencyMs: number,
  success: boolean,
  project?: string,
  errorMessage?: string,
) => void;

type RecordModelFeedbackFn = (
  endpointId: string,
  classification: TaskClassification,
  success: boolean,
  latencyMs: number,
) => void;

export interface TryProviderOptions {
  provider: LLMProvider;
  request: InternalLLMRequest;
  registry: TransformerRegistry;
  circuitBreaker: CircuitBreakerV2;
  startTime: number;
  model?: string;
  classification?: TaskClassification;
  routedEndpoint?: ModelEndpoint;
  resolveFeedbackEndpointId: (
    provider: LLMProvider,
    model: string | undefined,
    routedEndpoint?: ModelEndpoint,
  ) => string;
  recordUsage: RecordUsageFn;
  recordModelFeedback: RecordModelFeedbackFn;
}

/**
 * Extract a flat prompt string from InternalLLMRequest messages.
 * Used to bridge to the legacy GenerateRequest format.
 */
export function extractPromptFromInternal(request: InternalLLMRequest): string {
  const nonSystemMessages = request.messages.filter((m) => m.role !== 'system');
  return nonSystemMessages
    .map((m) => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((p) => p.type === 'text')
          .map((p) => (p as { type: 'text'; text: string }).text)
          .join('\n');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Extract system prompt from InternalLLMRequest messages.
 */
export function extractSystemFromInternal(request: InternalLLMRequest): string | undefined {
  const systemMessages = request.messages.filter((m) => m.role === 'system');
  if (systemMessages.length === 0) return undefined;

  return systemMessages
    .map((m) => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((p) => p.type === 'text')
          .map((p) => (p as { type: 'text'; text: string }).text)
          .join('\n');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Try a single provider through the transformer pipeline.
 * Handles both API providers (with outbound transformer) and CLI providers.
 * Records circuit breaker success/failure.
 */
export async function tryProvider(options: TryProviderOptions): Promise<InternalLLMResponse> {
  const {
    provider,
    request,
    registry,
    circuitBreaker,
    startTime,
    model = 'unknown',
    classification,
    routedEndpoint,
    resolveFeedbackEndpointId,
    recordUsage,
    recordModelFeedback,
  } = options;

  const outbound = registry.getOutbound(provider.id);
  const attemptedModel = request.model ?? model;
  const feedbackEndpointId = resolveFeedbackEndpointId(provider, attemptedModel, routedEndpoint);

  if (!outbound) {
    const cliOutbound = registry.getOutbound('cli');
    if (provider.type === 'cli' && cliOutbound) {
      try {
        const nativeRequest = cliOutbound.transformRequest(request);
        const prompt = (nativeRequest as Record<string, unknown>)['prompt'] as string;
        const system = (nativeRequest as Record<string, unknown>)['system'] as string | undefined;

        const result = await provider.generate({
          prompt,
          system,
          model: attemptedModel,
          maxTokens: request.maxTokens,
        });

        circuitBreaker.recordSuccess(provider.id, 'default', result.model ?? attemptedModel);
        const response = cliOutbound.transformResponse(result);
        const latencyMs = Date.now() - startTime;
        recordUsage(
          provider.id,
          response.model,
          response.usage.inputTokens,
          response.usage.outputTokens,
          latencyMs,
          true,
        );
        if (classification) {
          recordModelFeedback(feedbackEndpointId, classification, true, latencyMs);
        }
        return response;
      } catch (error) {
        circuitBreaker.recordFailure(provider.id, 'default', attemptedModel);
        const message = error instanceof Error ? error.message : String(error);
        const latencyMs = Date.now() - startTime;
        recordUsage(provider.id, attemptedModel, 0, 0, latencyMs, false, undefined, message);
        if (classification) {
          recordModelFeedback(feedbackEndpointId, classification, false, latencyMs);
        }
        logger.warn({ provider: provider.id, model: attemptedModel, error: message }, 'Provider failed (CLI transformer)');
        throw error;
      }
    }

    logger.warn({ provider: provider.id }, 'No outbound transformer registered, skipping');
    throw new Error(`no outbound transformer for ${provider.id}`);
  }

  try {
    outbound.transformRequest(request);

    const adapterRequest: GenerateRequest = {
      prompt: extractPromptFromInternal(request),
      system: extractSystemFromInternal(request),
      model: attemptedModel,
      maxTokens: request.maxTokens,
      provider: provider.id,
    };

    const result = await provider.generate(adapterRequest);
    circuitBreaker.recordSuccess(provider.id, 'default', result.model ?? model);

    const latencyMs = Date.now() - startTime;

    const response: InternalLLMResponse = {
      content: result.text,
      model: result.model,
      finishReason: 'stop',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: result.tokensUsed ?? 0,
      },
      metadata: {
        provider: result.provider,
        fallbackUsed: false,
        latencyMs,
        resolvedProvider: result.provider,
        resolvedModel: result.model,
      },
    };

    recordUsage(provider.id, result.model, response.usage.inputTokens, response.usage.outputTokens, latencyMs, true);
    if (classification) {
      recordModelFeedback(feedbackEndpointId, classification, true, latencyMs);
    }
    return response;
  } catch (error) {
    circuitBreaker.recordFailure(provider.id, 'default', attemptedModel);
    const message = error instanceof Error ? error.message : String(error);
    const latencyMs = Date.now() - startTime;
    recordUsage(provider.id, attemptedModel, 0, 0, latencyMs, false, undefined, message);
    if (classification) {
      recordModelFeedback(feedbackEndpointId, classification, false, latencyMs);
    }
    logger.warn({ provider: provider.id, model: attemptedModel, error: message }, 'Provider failed');
    throw error;
  }
}
