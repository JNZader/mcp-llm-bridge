import { useQuery } from "@tanstack/react-query";
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
