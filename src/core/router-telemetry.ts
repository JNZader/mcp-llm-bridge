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

export interface RouterTelemetryContext {
  analyticsAggregator: AnalyticsAggregator | null;
  costTracker: CostTracker | null;
  modelRouter: ModelRouter | null;
}

export interface RouterUsageRecordInput {
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  success: boolean;
  project?: string;
  errorMessage?: string;
}

export interface RouterModelFeedbackInput {
  endpointId: string;
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
  latencyMs: number;
  success: boolean;
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
    tokensIn: number,
    tokensOut: number,
    latencyMs: number,
    success: boolean,
    project?: string,
    errorMessage?: string,
  ) => void;
  recordModelFeedback: (
    endpointId: string,
    classification: TaskClassification,
    success: boolean,
    latencyMs: number,
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
  if (telemetry.analyticsAggregator) {
    try {
      const cost = calculateCost(input.model, input.tokensIn, input.tokensOut);
      telemetry.analyticsAggregator.record(input.provider, input.model, {
        inputTokens: input.tokensIn,
        outputTokens: input.tokensOut,
        cost,
        latencyMs: input.latencyMs,
        channel: input.project ?? 'default',
      });
    } catch (error) {
      logger.warn({ error }, 'Failed to record analytics');
    }
  }

  if (!telemetry.costTracker) return;

  try {
    telemetry.costTracker.record({
      provider: input.provider,
      model: input.model,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
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
      tokensIn,
      tokensOut,
      latencyMs,
      success,
      project,
      errorMessage,
    ) => {
      recordUsage(telemetry, {
        provider,
        model,
        tokensIn,
        tokensOut,
        latencyMs,
        success,
        project,
        errorMessage,
      });
    },
    recordModelFeedback: (endpointId, classification, success, latencyMs) => {
      recordModelFeedback(telemetry, {
        endpointId,
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
    tokensIn = 0,
    tokensOut = 0,
    latencyMs,
    success,
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
      tokensIn,
      tokensOut,
      latencyMs,
      success,
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
        classification: options.classification,
        success,
        latencyMs,
      });
    }
  };
}
