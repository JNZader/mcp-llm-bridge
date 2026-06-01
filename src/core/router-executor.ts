import type { GenerateRequest, GenerateResponse, LLMProvider } from './types.js';
import type { InternalLLMRequest, InternalLLMResponse } from './internal-model.js';
import type { TransformerRegistry } from './transformer.js';
import type { TaskClassification } from '../classification/index.js';
import type { ModelEndpoint } from '../model-routing/types.js';
import type { CircuitBreakerV2 } from '../circuit-breaker/circuit-breaker-v2.js';
import { LocalLLMError } from '../local-llm/client.js';
import { logger } from './logger.js';

type RecordUsageFn = (
  provider: string,
  model: string,
  usage: {
    totalTokens?: number;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
  },
  latencyMs: number,
  success: boolean,
  attempt?: number,
  project?: string,
  errorMessage?: string,
) => void;

type RecordModelFeedbackFn = (
  endpointId: string,
  classification: TaskClassification,
  success: boolean,
  latencyMs: number,
  selectedEndpointId?: string,
) => void;

type LogGenerateFailureFn = (context: {
  provider: LLMProvider;
  attemptedModel: string;
  message: string;
  error: unknown;
}) => void;

export interface ExecuteGenerateAttemptOptions {
  provider: LLMProvider;
  request: GenerateRequest;
  routedEndpoint?: ModelEndpoint;
  circuitBreaker: CircuitBreakerV2;
  defaultModel: string;
  classification?: TaskClassification | null;
  attempt: number;
  resolveFeedbackEndpointId: (
    provider: LLMProvider,
    model: string | undefined,
    routedEndpoint?: ModelEndpoint,
  ) => string;
  recordUsage: RecordUsageFn;
  recordModelFeedback: RecordModelFeedbackFn;
  logFailure?: LogGenerateFailureFn;
}

export interface TryProviderOptions {
  provider: LLMProvider;
  request: InternalLLMRequest;
  registry: TransformerRegistry;
  circuitBreaker: CircuitBreakerV2;
  model?: string;
  classification?: TaskClassification;
  attempt: number;
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
    model = 'unknown',
    classification,
    attempt,
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
      const attemptStartTime = Date.now();
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
        const latencyMs = Date.now() - attemptStartTime;
        recordUsage(
          provider.id,
          response.model,
          {
            totalTokens: response.usage.totalTokens,
            tokensIn: response.usage.inputTokens,
            tokensOut: response.usage.outputTokens,
          },
          latencyMs,
          true,
          attempt,
        );
        if (classification) {
          recordModelFeedback(feedbackEndpointId, classification, true, latencyMs, routedEndpoint?.id);
        }
        return response;
      } catch (error) {
        circuitBreaker.recordFailure(provider.id, 'default', attemptedModel);
        const message = error instanceof Error ? error.message : String(error);
        const latencyMs = Date.now() - attemptStartTime;
        recordUsage(provider.id, attemptedModel, {}, latencyMs, false, attempt, undefined, message);
        if (classification) {
          recordModelFeedback(feedbackEndpointId, classification, false, latencyMs, routedEndpoint?.id);
        }
        logger.warn({ provider: provider.id, model: attemptedModel, error: message }, 'Provider failed (CLI transformer)');
        throw error;
      }
    }

    logger.warn({ provider: provider.id }, 'No outbound transformer registered, skipping');
    throw new Error(`no outbound transformer for ${provider.id}`);
  }

  const attemptStartTime = Date.now();
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

    const latencyMs = Date.now() - attemptStartTime;

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

    recordUsage(
      provider.id,
      result.model,
      { totalTokens: result.tokensUsed },
      latencyMs,
      true,
      attempt,
    );
    if (classification) {
      recordModelFeedback(feedbackEndpointId, classification, true, latencyMs, routedEndpoint?.id);
    }
    return response;
  } catch (error) {
    circuitBreaker.recordFailure(provider.id, 'default', attemptedModel);
    const message = error instanceof Error ? error.message : String(error);
    const latencyMs = Date.now() - attemptStartTime;
    recordUsage(provider.id, attemptedModel, {}, latencyMs, false, attempt, undefined, message);
    if (classification) {
      recordModelFeedback(feedbackEndpointId, classification, false, latencyMs, routedEndpoint?.id);
    }
    logger.warn({ provider: provider.id, model: attemptedModel, error: message }, 'Provider failed');
    throw error;
  }
}

export async function executeGenerateAttempt(
  options: ExecuteGenerateAttemptOptions,
): Promise<GenerateResponse> {
  const {
    provider,
    request,
    routedEndpoint,
    circuitBreaker,
    defaultModel,
    classification,
    attempt,
    resolveFeedbackEndpointId,
    recordUsage,
    recordModelFeedback,
    logFailure,
  } = options;

  const attemptedModel = request.model ?? defaultModel;
  const attemptStartTime = Date.now();

  try {
    const result = await provider.generate(request);
    circuitBreaker.recordSuccess(provider.id, 'default', result.model ?? attemptedModel);
    const latencyMs = Date.now() - attemptStartTime;
    const resolvedModel = result.model ?? attemptedModel;
    recordUsage(
      provider.id,
      resolvedModel,
      { totalTokens: result.tokensUsed },
      latencyMs,
      true,
      attempt,
      request.project,
    );
    if (classification) {
      recordModelFeedback(
        resolveFeedbackEndpointId(provider, resolvedModel, routedEndpoint),
        classification,
        true,
        latencyMs,
        routedEndpoint?.id,
      );
    }
    return result;
  } catch (error) {
    circuitBreaker.recordFailure(provider.id, 'default', attemptedModel);
    const message = error instanceof Error ? error.message : String(error);
    const latencyMs = Date.now() - attemptStartTime;
    recordUsage(provider.id, attemptedModel, {}, latencyMs, false, attempt, request.project, message);
    if (classification) {
      recordModelFeedback(
        resolveFeedbackEndpointId(provider, attemptedModel, routedEndpoint),
        classification,
        false,
        latencyMs,
        routedEndpoint?.id,
      );
    }

    if (logFailure) {
      logFailure({ provider, attemptedModel, message, error });
    } else if (error instanceof LocalLLMError) {
      logger.warn(
        { provider: provider.id, model: attemptedModel, backend: error.backend, error: message },
        'Local LLM failed — falling back to cloud provider',
      );
    } else {
      logger.warn({ provider: provider.id, model: attemptedModel, error: message }, 'Provider failed');
    }

    throw error;
  }
}
