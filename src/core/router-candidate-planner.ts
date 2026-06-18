import type { GenerateRequest, LLMProvider } from './types.js';
import type { ProviderGroup } from './groups.js';
import type { ModelEndpoint } from '../model-routing/types.js';
import type { LatencyMeasurer } from '../latency/measurer.js';
import type { ProviderCandidate } from '../latency/types.js';
import type { CircuitBreakerV2 } from '../circuit-breaker/circuit-breaker-v2.js';
import { createBalancer, memberKey } from './balancer.js';
import { resolveModel } from './fuzzy.js';
import { buildLatencyMap, selectProviderWithLatency } from '../latency/selector.js';

/** Provider that can refresh its dynamic model cache (TTL-gated). */
export interface RefreshableModelProvider {
  refreshModels(): Promise<void>;
}

export function hasRefreshableModels(
  provider: unknown,
): provider is RefreshableModelProvider {
  return typeof (provider as { refreshModels?: unknown }).refreshModels === 'function';
}

export async function resolveCandidates(
  providers: LLMProvider[],
  request: GenerateRequest,
  reorderCandidates: (candidates: LLMProvider[]) => LLMProvider[],
): Promise<LLMProvider[]> {
  const availabilityResults = await Promise.all(
    providers.map(async (provider) => {
      const available = await provider.isAvailable();
      // Warm the dynamic model cache (TTL-gated) BEFORE model-based candidate
      // matching reads provider.models synchronously below — otherwise a cold
      // cache hides dynamically-discovered models from model-only routing
      // (3vr finding B). Never throws.
      if (available && hasRefreshableModels(provider)) {
        await provider.refreshModels().catch(() => {});
      }
      return { provider, available };
    }),
  );
  const available = availabilityResults
    .filter((result) => result.available)
    .map((result) => result.provider);

  if (request.provider) {
    const preferred = available.find((provider) => provider.id === request.provider);
    if (preferred) {
      return [preferred, ...available.filter((provider) => provider !== preferred)];
    }
  }

  if (request.model) {
    const modelProvider = available.find((provider) =>
      provider.models.some((model) => model.id === request.model),
    );
    if (modelProvider) {
      return [modelProvider, ...available.filter((provider) => provider !== modelProvider)];
    }

    const corpus = available.flatMap((provider) => provider.models.map((model) => model.id));
    const fuzzyResult = resolveModel(request.model, corpus);
    if (fuzzyResult) {
      const fuzzyProvider = available.find((provider) =>
        provider.models.some((model) => model.id === fuzzyResult.match),
      );
      if (fuzzyProvider) {
        return [fuzzyProvider, ...available.filter((provider) => provider !== fuzzyProvider)];
      }
    }
  }

  const sorted = available.sort((a, b) => {
    if (a.type === 'api' && b.type === 'cli') return -1;
    if (a.type === 'cli' && b.type === 'api') return 1;
    return 0;
  });

  return reorderCandidates(sorted);
}

export function resolveGroupCandidates(
  providers: LLMProvider[],
  group: ProviderGroup,
  canExecute: (providerId: string, model: string) => boolean,
  model: string = 'unknown',
): LLMProvider[] {
  const balancer = createBalancer(group.strategy);

  const excluded = new Set<string>();
  for (const member of group.members) {
    const key = memberKey(member);
    if (!canExecute(member.provider, model)) {
      excluded.add(key);
    }
  }

  const ordered: LLMProvider[] = [];
  const used = new Set<string>();

  for (let index = 0; index < group.members.length; index++) {
    const member = balancer.next(group.members, excluded);
    if (!member) break;

    const key = memberKey(member);
    if (used.has(key)) continue;
    used.add(key);

    const provider = providers.find((candidate) => candidate.id === member.provider);
    if (provider) {
      ordered.push(provider);
    }

    excluded.add(key);
  }

  return ordered;
}

export function prioritizeEndpointCandidate(
  candidates: LLMProvider[],
  endpoint: ModelEndpoint,
): LLMProvider[] | null {
  const selected = candidates.find((provider) => providerMatchesEndpoint(provider, endpoint));
  if (!selected) {
    return null;
  }

  return [selected, ...candidates.filter((provider) => provider !== selected)];
}

export function prioritizeProviderCandidate(
  candidates: LLMProvider[],
  providerId: string,
): LLMProvider[] {
  const selected = candidates.find((provider) => provider.id === providerId);
  if (!selected) {
    return candidates;
  }

  return [selected, ...candidates.filter((provider) => provider !== selected)];
}

export function providerMatchesEndpoint(provider: LLMProvider, endpoint: ModelEndpoint): boolean {
  return provider.id === endpoint.provider || provider.id === endpoint.id;
}

export function resolveProviderModel(
  currentModel: string | undefined,
  provider: LLMProvider,
  routedEndpoint?: ModelEndpoint,
): string | undefined {
  if (routedEndpoint && providerMatchesEndpoint(provider, routedEndpoint)) {
    return routedEndpoint.modelId;
  }

  return currentModel;
}

export interface ExecutableCandidatesResolution {
  availableCandidates: LLMProvider[];
  blockedStrictCandidate: LLMProvider | null;
}

export function resolveExecutableCandidates(
  candidates: LLMProvider[],
  circuitBreaker: CircuitBreakerV2,
  model: string,
  strict: boolean,
): ExecutableCandidatesResolution {
  if (strict) {
    const selectedCandidate = candidates[0] ?? null;
    if (!selectedCandidate) {
      return {
        availableCandidates: [],
        blockedStrictCandidate: null,
      };
    }

    if (!circuitBreaker.canExecute(selectedCandidate.id, 'default', model).allowed) {
      return {
        availableCandidates: [],
        blockedStrictCandidate: selectedCandidate,
      };
    }

    return {
      availableCandidates: [selectedCandidate],
      blockedStrictCandidate: null,
    };
  }

  return {
    availableCandidates: candidates.filter((provider) =>
      circuitBreaker.canExecute(provider.id, 'default', model).allowed,
    ),
    blockedStrictCandidate: null,
  };
}

export function reorderByLatency(
  candidates: LLMProvider[],
  latencyMeasurer: LatencyMeasurer | null,
  explorationRate: number,
): LLMProvider[] {
  if (!latencyMeasurer || candidates.length <= 1) {
    return candidates;
  }

  const measurements = latencyMeasurer.getAll();
  const latencyMap = buildLatencyMap(measurements);

  if (latencyMap.size === 0) {
    return candidates;
  }

  if (Math.random() < explorationRate) {
    const randomIndex = Math.floor(Math.random() * candidates.length);
    const picked = candidates[randomIndex];
    if (picked) {
      const rest = candidates.filter((_, index) => index !== randomIndex);
      return [picked, ...rest];
    }
  }

  const providerCandidates: ProviderCandidate[] = candidates.map((provider) => ({
    provider: provider.id,
  }));

  const selected = selectProviderWithLatency(providerCandidates, latencyMap, 0);
  const best = candidates.find((provider) => provider.id === selected.provider);

  if (best) {
    return [best, ...candidates.filter((provider) => provider !== best)];
  }

  return candidates;
}
