import { getCircuitBreakerV2 } from '../core/router.js';
import { circuitBreakerEnabled } from '../core/runtime-flags.js';

const LEGACY_CIRCUIT_STATE = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
} as const;

type LegacyCircuitState = (typeof LEGACY_CIRCUIT_STATE)[keyof typeof LEGACY_CIRCUIT_STATE];

export interface LegacyCircuitBreakerConfigView {
  enabled: boolean;
  failureThreshold: number;
  backoffBaseMs: number;
  backoffMultiplier: number;
  backoffMaxMs: number;
  resetTimeoutMs: number;
  halfOpenSuccessThreshold: number;
}

export interface LegacyCircuitBreakerStatsView {
  name: string;
  state: LegacyCircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number;
  currentCooldownMs: number;
  consecutiveFailures: number;
}

export interface ProviderCircuitBreakerSummary {
  state: LegacyCircuitState;
  failures: number;
  consecutiveFailures: number;
}

function statePriority(state: LegacyCircuitState): number {
  switch (state) {
    case LEGACY_CIRCUIT_STATE.OPEN:
      return 3;
    case LEGACY_CIRCUIT_STATE.HALF_OPEN:
      return 2;
    case LEGACY_CIRCUIT_STATE.CLOSED:
      return 1;
  }
}

export function getCircuitBreakerAdminConfig(): LegacyCircuitBreakerConfigView {
  const config = getCircuitBreakerV2().getConfig();

  return {
    enabled: circuitBreakerEnabled(),
    failureThreshold: config.failureThreshold,
    backoffBaseMs: config.baseCooldownMs,
    backoffMultiplier: config.backoffMultiplier,
    backoffMaxMs: config.maxCooldownMs,
    resetTimeoutMs: config.baseCooldownMs,
    halfOpenSuccessThreshold: config.halfOpenMaxRequests,
  };
}

export function updateCircuitBreakerAdminConfig(
  update: Partial<LegacyCircuitBreakerConfigView>,
): LegacyCircuitBreakerConfigView {
  const runtimeUpdate: {
    failureThreshold?: number;
    baseCooldownMs?: number;
    backoffMultiplier?: number;
    maxCooldownMs?: number;
    halfOpenMaxRequests?: number;
  } = {};

  if (typeof update.failureThreshold === 'number') {
    runtimeUpdate.failureThreshold = update.failureThreshold;
  }

  if (typeof update.backoffBaseMs === 'number') {
    runtimeUpdate.baseCooldownMs = update.backoffBaseMs;
  } else if (typeof update.resetTimeoutMs === 'number') {
    runtimeUpdate.baseCooldownMs = update.resetTimeoutMs;
  }

  if (typeof update.backoffMultiplier === 'number') {
    runtimeUpdate.backoffMultiplier = update.backoffMultiplier;
  }

  if (typeof update.backoffMaxMs === 'number') {
    runtimeUpdate.maxCooldownMs = update.backoffMaxMs;
  }

  if (typeof update.halfOpenSuccessThreshold === 'number') {
    runtimeUpdate.halfOpenMaxRequests = update.halfOpenSuccessThreshold;
  }

  getCircuitBreakerV2().updateConfig(runtimeUpdate);
  return getCircuitBreakerAdminConfig();
}

export function getCircuitBreakerAdminStats(): LegacyCircuitBreakerStatsView[] {
  const circuitBreaker = getCircuitBreakerV2();
  const config = circuitBreaker.getConfig();

  return circuitBreaker.getAllStates().map(({ key, entry }) => ({
    name: key,
    state: entry.state,
    failures: entry.consecutiveFailures,
    successes: 0,
    lastFailureTime: entry.lastFailureTime,
    currentCooldownMs:
      entry.state === LEGACY_CIRCUIT_STATE.OPEN && entry.tripCount > 0
        ? Math.min(
            config.baseCooldownMs * Math.pow(config.backoffMultiplier, entry.tripCount - 1),
            config.maxCooldownMs,
          )
        : 0,
    consecutiveFailures: entry.consecutiveFailures,
  }));
}

export function getProviderCircuitBreakerSummary(
  provider: string,
): ProviderCircuitBreakerSummary | null {
  const stats = getCircuitBreakerAdminStats().filter(
    (stat) => stat.name === provider || stat.name.startsWith(`${provider}:`),
  );

  if (stats.length === 0) {
    return null;
  }

  const state = stats.reduce<LegacyCircuitState>((current, stat) =>
    statePriority(stat.state) > statePriority(current) ? stat.state : current,
  LEGACY_CIRCUIT_STATE.CLOSED);

  return {
    state,
    failures: Math.max(...stats.map((stat) => stat.failures)),
    consecutiveFailures: Math.max(...stats.map((stat) => stat.consecutiveFailures)),
  };
}

export function resetProviderCircuitBreakers(provider: string): number {
  const circuitBreaker = getCircuitBreakerV2();
  const keys = circuitBreaker
    .getAllStates()
    .map(({ key }) => key)
    .filter((key) => key === provider || key.startsWith(`${provider}:`));

  for (const key of keys) {
    const [entryProvider, entryKey = 'default', ...modelParts] = key.split(':');
    const model = modelParts.join(':');
    if (!entryProvider || !model) {
      continue;
    }
    circuitBreaker.reset(entryProvider, entryKey, model);
  }

  return keys.length;
}
