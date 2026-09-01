import type { GenerateRequest, LLMProvider } from './types.js';
import type { ProviderGroup } from './groups.js';
import type { ModelEndpoint } from '../model-routing/types.js';
import type { LatencyMeasurer } from '../latency/measurer.js';
import type { ProviderCandidate } from '../latency/types.js';
import type { CircuitBreakerV2 } from '../circuit-breaker/circuit-breaker-v2.js';
import { createBalancer, memberKey } from './balancer.js';
import { resolveModel } from './fuzzy.js';
import { buildLatencyMap, selectProviderWithLatency } from '../latency/selector.js';

const NEVER_AUTO_FALLBACK_PROVIDER = {
  ANTHROPIC: 'anthropic',
  CLAUDE_CLI: 'claude-cli',
} as const;

export const NEVER_AUTO_FALLBACK = new Set<string>(
  Object.values(NEVER_AUTO_FALLBACK_PROVIDER),
);

/** Provider that can refresh its dynamic model cache (TTL-gated). */
export interface RefreshableModelProvider {
  refreshModels(): Promise<void>;
}

export function hasRefreshableModels(
  provider: unknown,
): provider is RefreshableModelProvider {
  return typeof (provider as { refreshModels?: unknown }).refreshModels === 'function';
}

export interface ResolveCandidatesOptions {
  explicitFallbackOrder?: readonly string[];
}

function filterNeverAutoFallback(
  candidates: LLMProvider[],
  requestedProvider: string | undefined,
  explicitFallbackAllowed: ReadonlySet<string>,
): LLMProvider[] {
  return candidates.filter((provider) => {
    if (!NEVER_AUTO_FALLBACK.has(provider.id)) {
      return true;
    }

    if (explicitFallbackAllowed.has(provider.id)) {
      return true;
    }

    return requestedProvider !== undefined && provider.id === requestedProvider;
  });
}

function buildCandidateList(
  selectedProvider: LLMProvider,
  available: LLMProvider[],
  requestedProvider: string | undefined,
  explicitFallbackAllowed: ReadonlySet<string>,
): LLMProvider[] {
  return filterNeverAutoFallback(
    [
      selectedProvider,
      ...available.filter((provider) => provider !== selectedProvider),
    ],
    requestedProvider,
    explicitFallbackAllowed,
  );
}

export async function resolveCandidates(
  providers: LLMProvider[],
  request: GenerateRequest,
  reorderCandidates: (candidates: LLMProvider[]) => LLMProvider[],
  options: ResolveCandidatesOptions = {},
): Promise<LLMProvider[]> {
  const explicitFallbackAllowed = new Set(options.explicitFallbackOrder ?? []);
  // Explicit provider is a pin, not a preference. Probe only that adapter:
  // do not `copilot --version` / `qwen --version` the rest of the fleet, and
  // never append them as fallbacks for a 20k–80k legal RAG prompt.
  if (request.provider) {
    const named = providers.find((provider) => provider.id === request.provider);
    if (!named) {
      return [];
    }
    return (await named.isAvailable()) ? [named] : [];
  }

  // Model-based candidate matching below reads provider.models synchronously,
  // so a cold cache would hide dynamically-discovered models (3vr B1).
  const needsModelDiscovery = request.model != null;
  const availabilityResults = await Promise.all(
    providers.map(async (provider) => {
      const available = await provider.isAvailable();
      if (needsModelDiscovery && available && hasRefreshableModels(provider)) {
        await provider.refreshModels().catch(() => {}); // TTL-gated; never throws
      }
      return { provider, available };
    }),
  );
  const available = availabilityResults
    .filter((result) => result.available)
    .map((result) => result.provider);

  if (request.model) {
    const modelProvider = available.find((provider) =>
      provider.models.some((model) => model.id === request.model),
    );
    if (modelProvider) {
      return buildCandidateList(
        modelProvider,
        available,
        request.provider,
        explicitFallbackAllowed,
      );
    }

    const corpus = available.flatMap((provider) => provider.models.map((model) => model.id));
    const fuzzyResult = resolveModel(request.model, corpus);
    if (fuzzyResult) {
      const fuzzyProvider = available.find((provider) =>
        provider.models.some((model) => model.id === fuzzyResult.match),
      );
      if (fuzzyProvider) {
        return buildCandidateList(
          fuzzyProvider,
          available,
          request.provider,
          explicitFallbackAllowed,
        );
      }
    }
  }

  const sorted = available.sort((a, b) => {
    if (a.type === 'api' && b.type === 'cli') return -1;
    if (a.type === 'cli' && b.type === 'api') return 1;
    return 0;
  });

  return reorderCandidates(
    filterNeverAutoFallback(sorted, request.provider, explicitFallbackAllowed),
  );
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
