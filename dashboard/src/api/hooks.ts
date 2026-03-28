import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateGroupInput, UpdateGroupInput } from "./types.ts";
import { ApiClient } from "./client.ts";
import { useAuth } from "../context/AuthContext.tsx";

function useApiClient(): ApiClient | null {
  const { token, baseUrl, logout } = useAuth();
  if (!token || !baseUrl) return null;
  return new ApiClient(baseUrl, token, logout);
}

export function useOverview() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["overview"],
    queryFn: () => client!.getOverview(),
    enabled: !!client,
  });
}

export function useProviders() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["providers"],
    queryFn: () => client!.getProviders(),
    enabled: !!client,
  });
}

export function useHealth() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["health"],
    queryFn: () => client!.getHealth(),
    enabled: !!client,
  });
}

export function useGroups() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["groups"],
    queryFn: () => client!.getGroups(),
    enabled: !!client,
  });
}

export function useCBStats() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["cb-stats"],
    queryFn: () => client!.getCBStats(),
    enabled: !!client,
  });
}

export function useCBConfig() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["cb-config"],
    queryFn: () => client!.getCBConfig(),
    enabled: !!client,
  });
}

export function useUsageSummary(params?: {
  from?: string;
  to?: string;
  groupBy?: "provider" | "model" | "project" | "hour" | "day";
}) {
  const client = useApiClient();
  return useQuery({
    queryKey: ["usage-summary", params],
    queryFn: () => client!.getUsageSummary(params),
    enabled: !!client,
  });
}

export function useModels() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["models"],
    queryFn: () => client!.getModels(),
    enabled: !!client,
  });
}

export function useUsageRecords(params?: {
  provider?: string;
  model?: string;
  from?: string;
  to?: string;
  limit?: number;
}) {
  const client = useApiClient();
  return useQuery({
    queryKey: ["usage-records", params],
    queryFn: () => client!.getUsageRecords(params),
    enabled: !!client,
  });
}

// ── Mutations ────────────────────────────────────────

export function useCreateGroup() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGroupInput) => client!.createGroup(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });
}

export function useUpdateGroup() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateGroupInput }) =>
      client!.updateGroup(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });
}

export function useDeleteGroup() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client!.deleteGroup(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });
}

export function useResetCircuitBreaker() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => client!.resetCircuitBreaker(provider),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cb-stats"] });
    },
  });
}
