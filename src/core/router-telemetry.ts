import type { LLMProvider } from './types.js';
import type { CostTracker } from './cost-tracker.js';
import type { AnalyticsAggregator } from '../analytics/index.js';
import type { ModelRouter } from '../model-routing/router.js';
import type { TaskClassification } from '../classification/index.js';
import type { ModelEndpoint } from '../model-routing/types.js';
import { calculateCost } from './pricing.js';
import {
  providerMatchesEndpoint,
  resolveProviderModel,
} from './router-candidate-planner.js';
import { logger } from './logger.js';
import { recordLlmAttemptMetric } from './metrics.js';

export interface RouterTelemetryContext {
  analyticsAggregator: AnalyticsAggregator | null;
  costTracker: CostTracker | null;
  modelRouter: ModelRouter | null;
}

export interface RouterUsageRecordInput {
  provider: string;
  model: string;
  totalTokens?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  persistUnknownUsage?: boolean;
  latencyMs: number;
  success: boolean;
  attempt?: number;
  project?: string;
  apiKeyId?: string;
  userId?: string;
  errorMessage?: string;
}

export interface RouterModelFeedbackInput {
  endpointId: string;
  selectedEndpointId?: string;
  classification: TaskClassification;
  success: boolean;
  latencyMs: number;
}

export interface RouterLocalFallbackMetricInput {
  attemptedModel: string;
  startTime: number;
  project?: string;
  apiKeyId?: string;
  userId?: string;
  message: string;
}

export interface RouterStreamingRecordResultInput {
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  totalTokens?: number;
  latencyMs: number;
  success: boolean;
  attempt?: number;
  project?: string;
  apiKeyId?: string;
  userId?: string;
  errorMessage?: string;
}

export interface RouterAttemptTelemetryCallbacks {
  resolveFeedbackEndpointId: (
    provider: LLMProvider,
    model: string | undefined,
    routedEndpoint?: ModelEndpoint,
  ) => string;
  recordUsage: (
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
    identity?: {
      apiKeyId?: string;
      userId?: string;
    },
  ) => void;
  recordModelFeedback: (
    endpointId: string,
    classification: TaskClassification,
    success: boolean,
    latencyMs: number,
    selectedEndpointId?: string,
  ) => void;
}

export interface RouterStreamingTelemetryOptions {
  telemetry: RouterTelemetryContext;
  provider: LLMProvider;
  requestModel?: string;
  routedEndpoint?: ModelEndpoint;
  classification?: TaskClassification | null;
  apiKeyId?: string;
  userId?: string;
}

export function resolveFeedbackEndpointId(
  telemetry: RouterTelemetryContext,
  provider: LLMProvider,
  model: string | undefined,
  routedEndpoint?: ModelEndpoint,
): string {
  if (routedEndpoint && providerMatchesEndpoint(provider, routedEndpoint)) {
    return routedEndpoint.id;
  }

  return telemetry.modelRouter?.findEndpointForProvider(provider.id, model)?.id ?? provider.id;
}

export function recordUsage(
  telemetry: RouterTelemetryContext,
  input: RouterUsageRecordInput,
): void {
  const hasExactSplit =
    typeof input.tokensIn === 'number' && typeof input.tokensOut === 'number';
  const totalTokens = input.totalTokens ?? (
    typeof input.tokensIn === 'number' && typeof input.tokensOut === 'number'
      ? input.tokensIn + input.tokensOut
      : undefined
  );
  const tokensIn = hasExactSplit ? input.tokensIn : undefined;
  const tokensOut = hasExactSplit ? input.tokensOut : undefined;

  recordLlmAttemptMetric({
    provider: input.provider,
    model: input.model,
    success: input.success,
    latencyMs: input.latencyMs,
    totalTokens,
  });

  if (telemetry.analyticsAggregator) {
    try {
      const cost = input.costUsd ?? (
        typeof input.tokensIn === 'number' && typeof input.tokensOut === 'number'
          ? calculateCost(input.model, input.tokensIn, input.tokensOut) ?? undefined
          : undefined
      );

      telemetry.analyticsAggregator.record(input.provider, input.model, {
        totalTokens,
        inputTokens: tokensIn,
        outputTokens: tokensOut,
        cost,
        latencyMs: input.latencyMs,
        success: input.success,
        attempt: input.attempt,
        channel: input.project ?? 'default',
      });
    } catch (error) {
      logger.warn({ error }, 'Failed to record analytics');
    }
  }

  if (!telemetry.costTracker) return;

  if (!hasExactSplit && typeof totalTokens !== 'number' && input.persistUnknownUsage !== true) {
    return;
  }

  try {
    telemetry.costTracker.record({
      provider: input.provider,
      keyName: input.apiKeyId,
      model: input.model,
      userId: input.userId,
      tokensIn,
      tokensOut,
      totalTokens,
      costUsd: input.costUsd,
      latencyMs: input.latencyMs,
      success: input.success,
      project: input.project,
      errorMessage: input.errorMessage,
    });
  } catch (error) {
    logger.warn({ error }, 'Failed to record usage');
  }
}

export function recordModelFeedback(
  telemetry: RouterTelemetryContext,
  input: RouterModelFeedbackInput,
): void {
  if (!telemetry.modelRouter) return;

  try {
    telemetry.modelRouter.recordFeedback({
      endpointId: input.endpointId,
      selectedEndpointId: input.selectedEndpointId,
      taskPattern: input.classification.task,
      acceptable: input.success,
      latencyMs: input.latencyMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.warn({ error, endpointId: input.endpointId }, 'Failed to record model routing feedback');
  }
}

export function recordLocalFallbackMetric(
  telemetry: RouterTelemetryContext,
  input: RouterLocalFallbackMetricInput,
): void {
  if (!telemetry.costTracker) return;

  try {
    telemetry.costTracker.record({
      provider: 'local-llm-fallback',
      keyName: input.apiKeyId,
      model: input.attemptedModel,
      userId: input.userId,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - input.startTime,
      success: false,
      project: input.project,
      errorMessage: `local-llm-fallback: ${input.message}`,
    });
  } catch {
    // Non-blocking metric emission
  }
}

export function createAttemptTelemetryCallbacks(
  telemetry: RouterTelemetryContext,
): RouterAttemptTelemetryCallbacks {
  return {
    resolveFeedbackEndpointId: (provider, model, routedEndpoint) =>
      resolveFeedbackEndpointId(telemetry, provider, model, routedEndpoint),
    recordUsage: (
      provider,
      model,
      usage,
      latencyMs,
      success,
      attempt,
      project,
      errorMessage,
      identity,
    ) => {
      recordUsage(telemetry, {
        provider,
        model,
        totalTokens: usage.totalTokens,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        costUsd: usage.costUsd,
        latencyMs,
        success,
        attempt,
        project,
        apiKeyId: identity?.apiKeyId,
        userId: identity?.userId,
        errorMessage,
      });
    },
    recordModelFeedback: (endpointId, classification, success, latencyMs, selectedEndpointId) => {
      recordModelFeedback(telemetry, {
        endpointId,
        selectedEndpointId,
        classification,
        success,
        latencyMs,
      });
    },
  };
}

export function createStreamingRecordResult(
  options: RouterStreamingTelemetryOptions,
): (input: RouterStreamingRecordResultInput) => void {
  return ({
    model,
    tokensIn,
    tokensOut,
    totalTokens,
    latencyMs,
    success,
    attempt,
    project,
    apiKeyId,
    userId,
    errorMessage,
  }) => {
    const resolvedModel =
      model ??
      resolveProviderModel(options.requestModel, options.provider, options.routedEndpoint) ??
      'unknown';

    recordUsage(options.telemetry, {
      provider: options.provider.id,
      model: resolvedModel,
      totalTokens,
      tokensIn,
      tokensOut,
      persistUnknownUsage: true,
      latencyMs,
      success,
      attempt,
      project,
      apiKeyId: apiKeyId ?? options.apiKeyId,
      userId: userId ?? options.userId,
      errorMessage,
    });

    if (options.classification) {
      recordModelFeedback(options.telemetry, {
        endpointId: resolveFeedbackEndpointId(
          options.telemetry,
          options.provider,
          resolvedModel,
          options.routedEndpoint,
        ),
        selectedEndpointId: options.routedEndpoint?.id,
        classification: options.classification,
        success,
        latencyMs,
      });
    }
  };
}
