import type { GenerateRequest, GenerateResponse, LLMProvider } from './types.js';
import type { InternalLLMRequest } from './internal-model.js';
import type { ModelEndpoint } from '../model-routing/types.js';
import { resolveProviderModel } from './router-candidate-planner.js';

export function withResolutionMetadata(
  request: GenerateRequest,
  result: GenerateResponse,
  fallbackUsed: boolean,
  latencyMs: number,
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
