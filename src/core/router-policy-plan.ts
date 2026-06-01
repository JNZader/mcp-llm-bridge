import type { LLMProvider } from './types.js';
import type { GroupStore, ProviderGroup } from './groups.js';
import type { LatencyMeasurer } from '../latency/measurer.js';
import type { ModelRouter } from '../model-routing/router.js';
import type { RoutingDecision } from '../model-routing/types.js';
import type { TaskClassification } from '../classification/index.js';
import type { CircuitBreakerV2 } from '../circuit-breaker/circuit-breaker-v2.js';
import type { SessionManager } from '../session/index.js';
import { classify } from '../classification/index.js';
import { classifyForOffload } from '../local-llm/router.js';
import {
  prioritizeEndpointCandidate,
  prioritizeProviderCandidate,
  reorderByLatency,
  resolveCandidates,
  resolveExecutableCandidates,
  resolveGroupCandidates,
} from './router-candidate-planner.js';
import { logger } from './logger.js';

export interface RoutingPolicyPlanRequest {
  prompt: string;
  provider?: string;
  model?: string;
  strict: boolean;
  clientId?: string;
}

export interface BuildRoutingPolicyPlanOptions {
  providers: LLMProvider[];
  request: RoutingPolicyPlanRequest;
  groupStore: GroupStore | null;
  sessionManager: SessionManager | null;
  latencyMeasurer: LatencyMeasurer | null;
  explorationRate: number;
  modelRouter: ModelRouter | null;
  circuitBreaker: CircuitBreakerV2;
  fallbackModel: string;
}

export interface StickySessionRoutingIntent {
  clientId: string;
  model: string;
  pinnedProviderId?: string;
  stickyTtlMs: number | null;
}

export interface RoutingPolicyPlan {
  requestModel?: string;
  matchedGroup: ProviderGroup | null;
  orderedCandidates: LLMProvider[];
  availableCandidates: LLMProvider[];
  blockedStrictCandidate: LLMProvider | null;
  classification: TaskClassification | null;
  offloadClassification: TaskClassification | null;
  modelRouterDecision: RoutingDecision | null;
  appliedModelRouterDecision: RoutingDecision | null;
  routedModel: string;
  requestedProvider?: string;
  strict: boolean;
  stickySession: StickySessionRoutingIntent | null;
}

export async function buildRoutingPolicyPlan(
  options: BuildRoutingPolicyPlanOptions,
): Promise<RoutingPolicyPlan> {
  const requestedProvider = options.request.provider;
  const requestModel = options.request.model;
  const strict = options.request.strict;
  let matchedGroup: ProviderGroup | null = null;
  let orderedCandidates: LLMProvider[] | null = null;

  if (!requestedProvider && options.groupStore && requestModel) {
    matchedGroup = options.groupStore.findByModel(requestModel);
    if (matchedGroup) {
      orderedCandidates = resolveGroupCandidates(
        options.providers,
        matchedGroup,
        (providerId, candidateModel) =>
          options.circuitBreaker.canExecute(providerId, 'default', candidateModel).allowed,
        requestModel,
      );
    }
  }

  if (!orderedCandidates) {
    orderedCandidates = await resolveCandidates(
      options.providers,
      {
        prompt: options.request.prompt,
        model: requestModel,
        provider: requestedProvider,
      },
      (candidates) =>
        reorderByLatency(candidates, options.latencyMeasurer, options.explorationRate),
    );
  }

  let classification: TaskClassification | null = null;
  let offloadClassification: TaskClassification | null = null;
  let modelRouterDecision: RoutingDecision | null = null;
  let appliedModelRouterDecision: RoutingDecision | null = null;

  if (options.modelRouter && options.modelRouter.enabled && !requestedProvider && !strict) {
    classification = classify(options.request.prompt);
    modelRouterDecision = options.modelRouter.route(classification);
    if (modelRouterDecision) {
      const routedCandidates = prioritizeEndpointCandidate(
        orderedCandidates,
        modelRouterDecision.endpoint,
      );
      if (routedCandidates) {
        orderedCandidates = routedCandidates;
        appliedModelRouterDecision = modelRouterDecision;
      } else {
        logger.warn({ endpointId: modelRouterDecision.endpoint.id }, 'Unmatched ModelRouter endpoint');
      }
    }
  }

  if (!requestedProvider && !strict && !modelRouterDecision) {
    offloadClassification = classifyForOffload(options.request.prompt);
    if (offloadClassification.shouldOffload) {
      orderedCandidates = prioritizeProviderCandidate(orderedCandidates, 'local-llm');
    }
  }

  const routedModel = modelRouterDecision?.endpoint.modelId ?? requestModel ?? options.fallbackModel;
  const { availableCandidates, blockedStrictCandidate } = resolveExecutableCandidates(
    orderedCandidates,
    options.circuitBreaker,
    routedModel,
    strict,
  );

  return {
    requestModel,
    matchedGroup,
    orderedCandidates,
    availableCandidates,
    blockedStrictCandidate,
    classification,
    offloadClassification,
    modelRouterDecision,
    appliedModelRouterDecision,
    routedModel,
    requestedProvider,
    strict,
    stickySession: buildStickySessionRoutingIntent({
      sessionManager: options.sessionManager,
      clientId: options.request.clientId,
      model: requestModel,
      requestedProvider,
      matchedGroup,
    }),
  };
}

interface BuildStickySessionRoutingIntentOptions {
  sessionManager: SessionManager | null;
  clientId?: string;
  model?: string;
  requestedProvider?: string;
  matchedGroup: ProviderGroup | null;
}

function buildStickySessionRoutingIntent(
  options: BuildStickySessionRoutingIntentOptions,
): StickySessionRoutingIntent | null {
  if (!options.sessionManager || !options.clientId || !options.model || options.requestedProvider) {
    return null;
  }

  return {
    clientId: options.clientId,
    model: options.model,
    pinnedProviderId: options.sessionManager.getRouterStickySession(
      options.clientId,
      options.model,
    )?.provider,
    stickyTtlMs: options.matchedGroup?.stickyTTL ? options.matchedGroup.stickyTTL * 1000 : null,
  };
}

export interface RoutingPolicyMetadataOptions {
  requestedProvider?: string;
  requestedModel?: string;
  modelRouterDecision: RoutingDecision | null;
  offloadClassification: TaskClassification | null;
}

export function determineRoutingStrategy(options: RoutingPolicyMetadataOptions): string {
  if (options.requestedProvider) {
    return 'explicit-provider';
  }

  if (options.modelRouterDecision) {
    return 'model-router';
  }

  if (options.offloadClassification?.shouldOffload) {
    return 'local-offload';
  }

  if (options.requestedModel) {
    return 'requested-model';
  }

  return 'standard';
}

export function determineDecisionReason(options: RoutingPolicyMetadataOptions): string {
  if (options.requestedProvider) {
    return `Provider ${options.requestedProvider} requested explicitly`;
  }

  if (options.modelRouterDecision) {
    return options.modelRouterDecision.reason;
  }

  if (options.offloadClassification?.reason) {
    return options.offloadClassification.reason;
  }

  if (options.requestedModel) {
    return `Model ${options.requestedModel} requested explicitly`;
  }

  return 'Resolved by standard provider ordering';
}
