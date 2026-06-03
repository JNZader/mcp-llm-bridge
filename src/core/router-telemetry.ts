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
  latencyMs: number;
  success: boolean;
  attempt?: number;
  project?: string;
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
  const totalTokens = input.totalTokens ?? (
    typeof input.tokensIn === 'number' && typeof input.tokensOut === 'number'
      ? input.tokensIn + input.tokensOut
      : undefined
  );
  const tokensIn = typeof input.tokensIn === 'number'
    ? input.tokensIn
    : typeof totalTokens === 'number'
      ? 0
      : !input.success
        ? 0
      : undefined;
  const tokensOut = typeof input.tokensOut === 'number'
    ? input.tokensOut
    : typeof totalTokens === 'number'
      ? totalTokens
      : !input.success
        ? 0
      : undefined;

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
          ? calculateCost(input.model, input.tokensIn, input.tokensOut)
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

  if (typeof tokensIn !== 'number' || typeof tokensOut !== 'number') {
    return;
  }

  try {
    telemetry.costTracker.record({
      provider: input.provider,
      model: input.model,
      tokensIn,
      tokensOut,
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
      model: input.attemptedModel,
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
      latencyMs,
      success,
      attempt,
      project,
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
