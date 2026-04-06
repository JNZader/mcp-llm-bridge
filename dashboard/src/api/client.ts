import type {
  HealthResponse,
  OverviewResponse,
  ProvidersResponse,
  GroupsResponse,
  ProviderGroup,
  CreateGroupInput,
  UpdateGroupInput,
  CircuitBreakerStatsResponse,
  CircuitBreakerConfigResponse,
  UsageSummaryResponse,
  UsageQueryResponse,
  ResetCBResponse,
  ModelsResponse,
} from "./types.ts";

interface UsageQueryParams {
  provider?: string;
  model?: string;
  project?: string;
  from?: string;
  to?: string;
  groupBy?: "provider" | "model" | "project" | "hour" | "day";
  limit?: number;
}

export class ApiClient {
  private baseUrl: string;
  private token: string;
  private onUnauthorized?: () => void;

  constructor(token: string, onUnauthorized?: () => void) {
    this.baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    this.token = token;
    this.onUnauthorized = onUnauthorized;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) ?? {}),
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    let response: Response;
    try {
      response = await fetch(url, { ...options, headers });
    } catch {
      throw new Error(`Network error: could not reach ${this.baseUrl}`);
    }

    if (response.status === 401 || response.status === 403) {
      this.onUnauthorized?.();
      throw new Error("Unauthorized: invalid or expired token");
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message =
        (body as { error?: string } | null)?.error ??
        `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(message);
    }

    return response.json() as Promise<T>;
  }

  // ── Health ────────────────────────────────────────

  getHealth(): Promise<HealthResponse> {
    return this.request("/v1/admin/health");
  }

  // ── Overview ──────────────────────────────────────

  getOverview(): Promise<OverviewResponse> {
    return this.request("/v1/admin/overview");
  }

  // ── Models ────────────────────────────────────────

  getModels(): Promise<ModelsResponse> {
    return this.request("/v1/models");
  }

  // ── Providers ─────────────────────────────────────

  getProviders(): Promise<ProvidersResponse> {
    return this.request("/v1/admin/providers");
  }

  // ── Groups ────────────────────────────────────────

  getGroups(): Promise<GroupsResponse> {
    return this.request("/v1/groups");
  }

  createGroup(input: CreateGroupInput): Promise<ProviderGroup> {
    return this.request("/v1/groups", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateGroup(id: string, input: UpdateGroupInput): Promise<ProviderGroup> {
    return this.request(`/v1/groups/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  deleteGroup(id: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/groups/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  // ── Circuit Breakers ──────────────────────────────

  getCBStats(): Promise<CircuitBreakerStatsResponse> {
    return this.request("/v1/circuit-breaker/stats");
  }

  getCBConfig(): Promise<CircuitBreakerConfigResponse> {
    return this.request("/v1/circuit-breaker/config");
  }

  resetCircuitBreaker(provider: string): Promise<ResetCBResponse> {
    return this.request(
      `/v1/admin/reset-circuit-breaker/${encodeURIComponent(provider)}`,
      { method: "POST" }
    );
  }

  // ── Usage ─────────────────────────────────────────

  getUsageSummary(params?: UsageQueryParams): Promise<UsageSummaryResponse> {
    const searchParams = new URLSearchParams();
    if (params?.provider) searchParams.set("provider", params.provider);
    if (params?.model) searchParams.set("model", params.model);
    if (params?.project) searchParams.set("project", params.project);
    if (params?.from) searchParams.set("from", params.from);
    if (params?.to) searchParams.set("to", params.to);
    if (params?.groupBy) searchParams.set("groupBy", params.groupBy);

    const qs = searchParams.toString();
    return this.request(`/v1/usage/summary${qs ? `?${qs}` : ""}`);
  }

  getUsageRecords(params?: UsageQueryParams): Promise<UsageQueryResponse> {
    const searchParams = new URLSearchParams();
    if (params?.provider) searchParams.set("provider", params.provider);
    if (params?.model) searchParams.set("model", params.model);
    if (params?.project) searchParams.set("project", params.project);
    if (params?.from) searchParams.set("from", params.from);
    if (params?.to) searchParams.set("to", params.to);
    if (params?.groupBy) searchParams.set("groupBy", params.groupBy);
    if (params?.limit) searchParams.set("limit", String(params.limit));

    const qs = searchParams.toString();
    return this.request(`/v1/usage${qs ? `?${qs}` : ""}`);
  }
}
