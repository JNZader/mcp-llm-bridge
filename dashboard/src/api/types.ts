// ── Const Types ─────────────────────────────────────────

const PROVIDER_TYPE = {
  API: "api",
  CLI: "cli",
} as const;

type ProviderType = (typeof PROVIDER_TYPE)[keyof typeof PROVIDER_TYPE];

const CIRCUIT_STATE = {
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN",
} as const;

type CircuitState = (typeof CIRCUIT_STATE)[keyof typeof CIRCUIT_STATE];

const BALANCER_STRATEGY = {
  ROUND_ROBIN: "round-robin",
  RANDOM: "random",
  FAILOVER: "failover",
  WEIGHTED: "weighted",
} as const;

type BalancerStrategy =
  (typeof BALANCER_STRATEGY)[keyof typeof BALANCER_STRATEGY];

// ── Health ──────────────────────────────────────────────

interface MemoryUsage {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
}

interface ProviderCount {
  available: number;
  total: number;
}

interface DatabaseStatus {
  connected: boolean;
}

export interface HealthResponse {
  status: string;
  database: DatabaseStatus;
  providers: ProviderCount;
  uptime: number;
  version: string;
  memory: MemoryUsage;
}

// ── Models ──────────────────────────────────────────────

interface ModelInfo {
  id: string;
  name: string;
  maxTokens: number;
}

export interface ModelsResponse {
  object: string;
  data: ModelInfo[];
}

// ── Overview ────────────────────────────────────────────

interface OverviewProvider {
  id: string;
  name: string;
  type: ProviderType;
  available: boolean;
}

interface OverviewGroup {
  id: string;
  name: string;
  memberCount: number;
  strategy: string;
  modelPattern?: string;
}

interface CircuitBreakerSummary {
  total: number;
  open: number;
  closed: number;
  halfOpen: number;
}

interface UsageOverview {
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
}

interface SystemInfo {
  uptime: number;
  version: string;
  mode: string;
}

export interface OverviewResponse {
  providers: OverviewProvider[];
  groups: OverviewGroup[];
  circuitBreakers: CircuitBreakerSummary;
  usage: UsageOverview;
  system: SystemInfo;
}

// ── Providers ───────────────────────────────────────────

interface CircuitBreakerInfo {
  state: CircuitState;
  failures: number;
  consecutiveFailures: number;
}

export interface ProviderDetail {
  id: string;
  name: string;
  type: ProviderType;
  available: boolean;
  models: ModelInfo[];
  circuitBreaker: CircuitBreakerInfo;
}

export interface ProvidersResponse {
  providers: ProviderDetail[];
}

// ── Groups ──────────────────────────────────────────────

interface GroupMember {
  provider: string;
  weight?: number;
}

export interface ProviderGroup {
  id: string;
  name: string;
  modelPattern?: string;
  members: GroupMember[];
  strategy: BalancerStrategy;
  weights?: Record<string, number>;
  stickyTTL?: number;
}

export interface GroupsResponse {
  groups: ProviderGroup[];
}

export interface CreateGroupInput {
  name: string;
  modelPattern?: string;
  members: GroupMember[];
  strategy: BalancerStrategy;
  weights?: Record<string, number>;
  stickyTTL?: number;
}

export interface UpdateGroupInput {
  name?: string;
  modelPattern?: string;
  members?: GroupMember[];
  strategy?: BalancerStrategy;
  weights?: Record<string, number>;
  stickyTTL?: number;
}

// ── Circuit Breakers ────────────────────────────────────

export interface CircuitBreakerStat {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number;
  currentCooldownMs: number;
  consecutiveFailures: number;
}

export interface CircuitBreakerStatsResponse {
  enabled: boolean;
  breakers: CircuitBreakerStat[];
}

export interface CircuitBreakerConfigResponse {
  enabled: boolean;
  failureThreshold: number;
  backoffBaseMs: number;
  backoffMultiplier: number;
  backoffMaxMs: number;
  resetTimeoutMs: number;
  halfOpenSuccessThreshold: number;
}

// ── Usage ───────────────────────────────────────────────

interface UsageBreakdown {
  key: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface UsageSummaryResponse {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  breakdown: UsageBreakdown[];
}

interface UsageRecord {
  id: string;
  provider: string;
  model: string;
  project?: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  createdAt: string;
}

export interface UsageQueryResponse {
  records: UsageRecord[];
  count: number;
}

// ── Admin Operations ────────────────────────────────────

export interface ResetCBResponse {
  ok: boolean;
  provider: string;
  state: string;
  message: string;
}

export interface ApiError {
  error: string;
  code?: string;
  field?: string;
}

// ── Re-exports for convenience ──────────────────────────

export { PROVIDER_TYPE, CIRCUIT_STATE, BALANCER_STRATEGY };
export type { ProviderType, CircuitState, BalancerStrategy, GroupMember, ModelInfo };
