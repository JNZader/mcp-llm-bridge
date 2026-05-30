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
  classification: TaskClassification | null;
  modelRouterDecision: RoutingDecision | null;
  routedModel: string;
}

export async function buildInternalRoutingPlan(
  options: BuildInternalRoutingPlanOptions,
): Promise<InternalRoutingPlan> {
  const optimizedRequest = options.optimizeMessages
    ? { ...options.request, messages: optimizeMessages(options.request.messages) }
    : options.request;

  const model = optimizedRequest.model ?? '';
  let matchedGroup: ProviderGroup | null = null;
  let orderedCandidates: LLMProvider[] | null = null;

  if (options.groupStore && model) {
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
      provider: optimizedRequest.metadata?.['provider'] as string | undefined,
    };
    orderedCandidates = await resolveCandidates(options.providers, resolveRequest, (candidates) =>
      reorderByLatency(candidates, options.latencyMeasurer, options.explorationRate),
    );
  }

  let classification: TaskClassification | null = null;
  let modelRouterDecision: RoutingDecision | null = null;
  if (options.modelRouter && options.modelRouter.enabled) {
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

  const requestedProvider = optimizedRequest.metadata?.['provider'] as string | undefined;
  if (!requestedProvider && !modelRouterDecision) {
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
  const availableCandidates = orderedCandidates.filter((provider) =>
    options.circuitBreaker.canExecute(provider.id, 'default', routedModel).allowed,
  );

  return {
    optimizedRequest,
    model,
    matchedGroup,
    orderedCandidates,
    availableCandidates,
    classification,
    modelRouterDecision,
    routedModel,
  };
}
