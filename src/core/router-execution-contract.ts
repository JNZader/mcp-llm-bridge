import type { GenerateRequest, GenerateResponse, RoutingMetadata } from './types.js';
import {
  buildRoutingMetadata,
  type InternalResolutionMetadataOptions,
  type RoutingMetadataOptions,
  withResolutionMetadata,
} from './router-shaping.js';

export interface RouterExecutionContractOptions {
  requestedProvider?: string;
  requestedModel?: string;
  routingMetadata: Omit<RoutingMetadataOptions, 'attemptedProviders'>;
}

export interface RouterExecutionSnapshot {
  requestedProvider?: string;
  requestedModel?: string;
  attemptedProviders: string[];
  fallbackUsed: boolean;
  routing: RoutingMetadata;
}

export interface RouterExecutionContract {
  readonly requestedProvider?: string;
  readonly requestedModel?: string;
  readonly routingMetadata: Omit<RoutingMetadataOptions, 'attemptedProviders'>;
  readonly attemptedProviders: string[];
  recordAttempt: (providerId: string) => void;
  snapshot: (resolvedProvider: string) => RouterExecutionSnapshot;
}

export interface StreamingExecutionResponseDataInput {
  providerId: string;
  resolvedModel: string;
  responseModel?: string;
}

export function createRouterExecutionContract(
  options: RouterExecutionContractOptions,
): RouterExecutionContract {
  const attemptedProviders: string[] = [];

  return {
    requestedProvider: options.requestedProvider,
    requestedModel: options.requestedModel,
    routingMetadata: options.routingMetadata,
    attemptedProviders,
    recordAttempt(providerId: string) {
      attemptedProviders.push(providerId);
    },
    snapshot(resolvedProvider: string): RouterExecutionSnapshot {
      const attemptedSnapshot =
        attemptedProviders.length > 0 ? [...attemptedProviders] : [resolvedProvider];
      const fallbackUsed =
        attemptedProviders.length > 0 ? attemptedProviders[0] !== resolvedProvider : false;

      return {
        requestedProvider: options.requestedProvider,
        requestedModel: options.requestedModel,
        attemptedProviders: attemptedSnapshot,
        fallbackUsed,
        routing: buildRoutingMetadata(
          { provider: resolvedProvider },
          fallbackUsed,
          {
            ...options.routingMetadata,
            attemptedProviders: attemptedSnapshot,
          },
        ),
      };
    },
  };
}

export function buildInternalResolutionMetadataOptions(
  contract: RouterExecutionContract,
  input: {
    resolvedProvider: string;
    resolvedModel: string;
    latencyMs?: number;
  },
): InternalResolutionMetadataOptions {
  const snapshot = contract.snapshot(input.resolvedProvider);

  return {
    requestedProvider: snapshot.requestedProvider,
    requestedModel: snapshot.requestedModel,
    resolvedProvider: input.resolvedProvider,
    resolvedModel: input.resolvedModel,
    fallbackUsed: snapshot.fallbackUsed,
    attemptedProviders: snapshot.attemptedProviders,
    latencyMs: input.latencyMs,
    ...contract.routingMetadata,
  };
}

export function buildGenerateExecutionResponse(
  contract: RouterExecutionContract,
  input: {
    request: GenerateRequest;
    result: GenerateResponse;
    latencyMs: number;
  },
): GenerateResponse {
  const snapshot = contract.snapshot(input.result.provider);

  return withResolutionMetadata(
    input.request,
    input.result,
    snapshot.fallbackUsed,
    input.latencyMs,
    snapshot.routing,
  );
}

export function buildStreamingExecutionResponseData(
  contract: RouterExecutionContract,
  input: StreamingExecutionResponseDataInput,
) {
  const snapshot = contract.snapshot(input.providerId);

  return {
    stream: true,
    provider: input.providerId,
    model: input.responseModel ?? input.resolvedModel,
    requestedProvider: snapshot.requestedProvider,
    requestedModel: snapshot.requestedModel,
    resolvedProvider: input.providerId,
    resolvedModel: input.resolvedModel,
    fallbackUsed: snapshot.fallbackUsed,
    routing: snapshot.routing,
  };
}
