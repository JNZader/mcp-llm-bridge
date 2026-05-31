import type { GenerateRequest, LLMProvider } from './types.js';
import type { InternalLLMRequest } from './internal-model.js';
import type { GroupStore, ProviderGroup } from './groups.js';
import type { LatencyMeasurer } from '../latency/measurer.js';
import type { ModelRouter } from '../model-routing/router.js';
import type { RoutingDecision } from '../model-routing/types.js';
import type { TaskClassification } from '../classification/index.js';
import type { CircuitBreakerV2 } from '../circuit-breaker/circuit-breaker-v2.js';
import { classify } from '../classification/index.js';
import { classifyForOffload } from '../local-llm/router.js';
import { optimizeMessages } from '../transformers/three-part-prompt.js';
import {
  prioritizeEndpointCandidate,
  reorderByLatency,
  resolveExecutableCandidates,
  resolveCandidates,
  resolveGroupCandidates,
} from './router-candidate-planner.js';
import { extractPromptFromInternal } from './router-executor.js';
import { logger } from './logger.js';

interface BuildInternalRoutingPlanOptions {
  providers: LLMProvider[];
  request: InternalLLMRequest;
  groupStore: GroupStore | null;
  latencyMeasurer: LatencyMeasurer | null;
  explorationRate: number;
  modelRouter: ModelRouter | null;
  circuitBreaker: CircuitBreakerV2;
  optimizeMessages: boolean;
}

export interface InternalRoutingPlan {
  optimizedRequest: InternalLLMRequest;
  model: string;
  matchedGroup: ProviderGroup | null;
  orderedCandidates: LLMProvider[];
  availableCandidates: LLMProvider[];
  blockedStrictCandidate: LLMProvider | null;
  classification: TaskClassification | null;
  modelRouterDecision: RoutingDecision | null;
  routedModel: string;
  requestedProvider?: string;
  strict: boolean;
}

export async function buildInternalRoutingPlan(
  options: BuildInternalRoutingPlanOptions,
): Promise<InternalRoutingPlan> {
  const optimizedRequest = options.optimizeMessages
    ? { ...options.request, messages: optimizeMessages(options.request.messages) }
    : options.request;

  const model = optimizedRequest.model ?? '';
  const requestedProvider =
    typeof optimizedRequest.metadata?.['provider'] === 'string'
      ? optimizedRequest.metadata['provider']
      : undefined;
  const strict = optimizedRequest.metadata?.['strict'] === true;
  let matchedGroup: ProviderGroup | null = null;
  let orderedCandidates: LLMProvider[] | null = null;

  if (!requestedProvider && options.groupStore && model) {
    matchedGroup = options.groupStore.findByModel(model);
    if (matchedGroup) {
      orderedCandidates = resolveGroupCandidates(
        options.providers,
        matchedGroup,
        (providerId, candidateModel) =>
          options.circuitBreaker.canExecute(providerId, 'default', candidateModel).allowed,
        model,
      );
    }
  }

  if (!orderedCandidates) {
    const resolveRequest: GenerateRequest = {
      prompt: '',
      model: optimizedRequest.model,
      provider: requestedProvider,
    };
    orderedCandidates = await resolveCandidates(options.providers, resolveRequest, (candidates) =>
      reorderByLatency(candidates, options.latencyMeasurer, options.explorationRate),
    );
  }

  let classification: TaskClassification | null = null;
  let modelRouterDecision: RoutingDecision | null = null;
  if (options.modelRouter && options.modelRouter.enabled && !requestedProvider && !strict) {
    classification = classify(extractPromptFromInternal(optimizedRequest));
    modelRouterDecision = options.modelRouter.route(classification);
    if (modelRouterDecision) {
      const routedCandidates = prioritizeEndpointCandidate(
        orderedCandidates,
        modelRouterDecision.endpoint,
      );
      if (routedCandidates) {
        orderedCandidates = routedCandidates;
      } else {
        logger.warn({ endpointId: modelRouterDecision.endpoint.id }, 'Unmatched ModelRouter endpoint');
      }
    }
  }

  if (!requestedProvider && !strict && !modelRouterDecision) {
    const offloadClassification = classifyForOffload(extractPromptFromInternal(optimizedRequest));
    if (offloadClassification.shouldOffload) {
      const localIndex = orderedCandidates.findIndex((provider) => provider.id === 'local-llm');
      if (localIndex > 0) {
        const localProvider = orderedCandidates[localIndex]!;
        orderedCandidates = [
          localProvider,
          ...orderedCandidates.filter((_, index) => index !== localIndex),
        ];
      }
    }
  }

  const routedModel = modelRouterDecision?.endpoint.modelId ?? model;
  const { availableCandidates, blockedStrictCandidate } = resolveExecutableCandidates(
    orderedCandidates,
    options.circuitBreaker,
    routedModel,
    strict,
  );

  return {
    optimizedRequest,
    model,
    matchedGroup,
    orderedCandidates,
    availableCandidates,
    blockedStrictCandidate,
    classification,
    modelRouterDecision,
    routedModel,
    requestedProvider,
    strict,
  };
}
