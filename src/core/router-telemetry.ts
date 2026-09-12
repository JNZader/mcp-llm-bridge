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
import { parseUsageTelemetryInput } from './telemetry-contracts.js';
import { normalizeTelemetryFailure } from './telemetry-failure.js';

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
  const failure = input.errorMessage ? normalizeTelemetryFailure(input.errorMessage) : undefined;
  const { errorMessage: _errorMessage, ...metadata } = input;
  const safeInput = parseUsageTelemetryInput({
    ...metadata,
    ...(failure ? { errorCode: failure.code } : {}),
  });
  const hasExactSplit =
    typeof safeInput.tokensIn === 'number' && typeof safeInput.tokensOut === 'number';
  const totalTokens = safeInput.totalTokens ?? (
    typeof safeInput.tokensIn === 'number' && typeof safeInput.tokensOut === 'number'
      ? safeInput.tokensIn + safeInput.tokensOut
      : undefined
  );
  const tokensIn = hasExactSplit ? safeInput.tokensIn : undefined;
  const tokensOut = hasExactSplit ? safeInput.tokensOut : undefined;

  recordLlmAttemptMetric({
    provider: safeInput.provider,
    model: safeInput.model,
    success: safeInput.success,
    latencyMs: safeInput.latencyMs,
    totalTokens,
  });

  if (telemetry.analyticsAggregator) {
    try {
      const cost = safeInput.costUsd ?? (
        typeof safeInput.tokensIn === 'number' && typeof safeInput.tokensOut === 'number'
          ? calculateCost(safeInput.model, safeInput.tokensIn, safeInput.tokensOut) ?? undefined
          : undefined
      );

      telemetry.analyticsAggregator.record(safeInput.provider, safeInput.model, {
        totalTokens,
        inputTokens: tokensIn,
        outputTokens: tokensOut,
        cost,
        latencyMs: safeInput.latencyMs,
        success: safeInput.success,
        attempt: input.attempt,
        channel: safeInput.project ?? 'default',
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
      provider: safeInput.provider,
      keyName: safeInput.apiKeyId,
      model: safeInput.model,
      userId: safeInput.userId,
      tokensIn,
      tokensOut,
      totalTokens,
      costUsd: safeInput.costUsd,
      latencyMs: safeInput.latencyMs,
      success: safeInput.success,
      project: safeInput.project,
      ...(failure ? { errorCode: failure.code, errorCategory: failure.category } : {}),
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
      errorCode: normalizeTelemetryFailure(input.message).code,
      errorCategory: normalizeTelemetryFailure(input.message).category,
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
