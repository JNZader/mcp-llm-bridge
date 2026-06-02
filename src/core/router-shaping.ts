import type { TaskClassification } from '../classification/index.js';
import type { RoutingDecision } from '../model-routing/types.js';
import type { GenerateRequest, GenerateResponse, LLMProvider, RoutingMetadata } from './types.js';
import type { InternalLLMRequest, InternalLLMResponse } from './internal-model.js';
import type { ModelEndpoint } from '../model-routing/types.js';
import { resolveProviderModel } from './router-candidate-planner.js';

export interface RoutingMetadataOptions {
  strategy: string;
  attemptedProviders: string[];
  classification?: TaskClassification | null;
  modelRouterDecision?: RoutingDecision | null;
  decisionReason?: string;
}

export interface InternalResolutionMetadataOptions extends RoutingMetadataOptions {
  requestedProvider?: string;
  requestedModel?: string;
  resolvedProvider: string;
  resolvedModel: string;
  fallbackUsed: boolean;
  latencyMs?: number;
}

export function withResolutionMetadata(
  request: GenerateRequest,
  result: GenerateResponse,
  fallbackUsed: boolean,
  latencyMs: number,
  routing?: RoutingMetadata,
): GenerateResponse {
  return {
    ...result,
    requestedProvider: request.provider,
    requestedModel: request.model,
    resolvedProvider: result.provider,
    resolvedModel: result.model,
    fallbackUsed,
    latencyMs,
    sessionId: result.sessionId,
    routing,
  };
}

export function buildRoutingMetadata(
  result: Pick<GenerateResponse, 'provider'>,
  fallbackUsed: boolean,
  options: RoutingMetadataOptions,
): RoutingMetadata {
  const attemptedProviders = [...options.attemptedProviders];
  const routing: RoutingMetadata = {
    strategy: options.strategy,
    attemptedProviders,
  };

  if (options.classification) {
    routing.classification = options.classification;
  }

  if (options.modelRouterDecision) {
    routing.matchedRuleId = options.modelRouterDecision.matchedRule.id;
    routing.selectedEndpointId = options.modelRouterDecision.endpoint.id;
  }

  if (options.decisionReason) {
    routing.decisionReason = options.decisionReason;
  }

  if (fallbackUsed && attemptedProviders.length > 0 && attemptedProviders[0] !== result.provider) {
    routing.fallbackFrom = attemptedProviders[0];
    routing.fallbackTo = result.provider;
  }

  return routing;
}

export function withInternalResolutionMetadata(
  result: InternalLLMResponse,
  options: InternalResolutionMetadataOptions,
): InternalLLMResponse {
  const metadata: Record<string, unknown> = {
    ...result.metadata,
    provider: options.resolvedProvider,
    resolvedProvider: options.resolvedProvider,
    resolvedModel: options.resolvedModel,
    fallbackUsed: options.fallbackUsed,
    attemptedProviders: [...options.attemptedProviders],
    routing: buildRoutingMetadata(
      { provider: options.resolvedProvider },
      options.fallbackUsed,
      options,
    ),
  };

  if (options.requestedProvider !== undefined) {
    metadata['requestedProvider'] = options.requestedProvider;
  }

  if (options.requestedModel !== undefined) {
    metadata['requestedModel'] = options.requestedModel;
  }

  if (options.latencyMs !== undefined && metadata['latencyMs'] === undefined) {
    metadata['latencyMs'] = options.latencyMs;
  }

  return {
    ...result,
    metadata,
  };
}

export function buildGenerateRequest(
  request: GenerateRequest,
  provider: LLMProvider,
  routedEndpoint?: ModelEndpoint,
): GenerateRequest {
  return {
    ...request,
    provider: provider.id,
    model: resolveProviderModel(request.model, provider, routedEndpoint),
  };
}

export function buildInternalRequest(
  request: InternalLLMRequest,
  provider: LLMProvider,
  routedEndpoint?: ModelEndpoint,
): InternalLLMRequest {
  return {
    ...request,
    metadata: {
      ...request.metadata,
      provider: provider.id,
    },
    model: resolveProviderModel(request.model, provider, routedEndpoint),
  };
}
