import type { LLMProvider } from './types.js';
import type { InternalLLMRequest } from './internal-model.js';
import type { GroupStore, ProviderGroup } from './groups.js';
import type { LatencyMeasurer } from '../latency/measurer.js';
import type { ModelRouter } from '../model-routing/router.js';
import type { RoutingDecision } from '../model-routing/types.js';
import type { TaskClassification } from '../classification/index.js';
import type { CircuitBreakerV2 } from '../circuit-breaker/circuit-breaker-v2.js';
import type { SessionManager } from '../session/index.js';
import { optimizeMessages } from '../transformers/three-part-prompt.js';
import { extractPromptFromInternal } from './router-executor.js';
import {
  buildRoutingPolicyPlan,
  type StickySessionRoutingIntent,
} from './router-policy-plan.js';

interface BuildInternalRoutingPlanOptions {
  providers: LLMProvider[];
  request: InternalLLMRequest;
  groupStore: GroupStore | null;
  sessionManager: SessionManager | null;
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
  offloadClassification: TaskClassification | null;
  modelRouterDecision: RoutingDecision | null;
  appliedModelRouterDecision: RoutingDecision | null;
  routedModel: string;
  requestedProvider?: string;
  strict: boolean;
  stickySession: StickySessionRoutingIntent | null;
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
  const sharedPlan = await buildRoutingPolicyPlan({
    providers: options.providers,
    request: {
      prompt: extractPromptFromInternal(optimizedRequest),
      model: optimizedRequest.model,
      provider: requestedProvider,
      strict,
      clientId:
        typeof optimizedRequest.metadata?.['clientId'] === 'string'
          ? optimizedRequest.metadata['clientId']
          : undefined,
    },
    groupStore: options.groupStore,
    sessionManager: options.sessionManager,
    latencyMeasurer: options.latencyMeasurer,
    explorationRate: options.explorationRate,
    modelRouter: options.modelRouter,
    circuitBreaker: options.circuitBreaker,
    fallbackModel: '',
  });

  return {
    optimizedRequest,
    model,
    matchedGroup: sharedPlan.matchedGroup,
    orderedCandidates: sharedPlan.orderedCandidates,
    availableCandidates: sharedPlan.availableCandidates,
    blockedStrictCandidate: sharedPlan.blockedStrictCandidate,
    classification: sharedPlan.classification,
    offloadClassification: sharedPlan.offloadClassification,
    modelRouterDecision: sharedPlan.modelRouterDecision,
    appliedModelRouterDecision: sharedPlan.appliedModelRouterDecision,
    routedModel: sharedPlan.routedModel,
    requestedProvider: sharedPlan.requestedProvider,
    strict: sharedPlan.strict,
    stickySession: sharedPlan.stickySession,
  };
}
