import { useState } from "react";
import { BarChart3, DollarSign, Zap, Clock, Loader2, Hash } from "lucide-react";
import { useUsageSummary, useUsageRecords, useProviders } from "../api/hooks.ts";
import { KpiCard } from "../components/KpiCard.tsx";
import { CostChart } from "../components/CostChart.tsx";
import { DataTable } from "../components/DataTable.tsx";
import { EmptyState } from "../components/EmptyState.tsx";

export function Usage() {
  const [providerFilter, setProviderFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");

  const { data: summary, isLoading: summaryLoading } = useUsageSummary({
    groupBy: "day",
    ...(providerFilter ? { provider: providerFilter } : {}),
    ...(modelFilter ? { model: modelFilter } : {}),
  });

  const { data: records, isLoading: recordsLoading } = useUsageRecords({
    limit: 50,
    ...(providerFilter ? { provider: providerFilter } : {}),
    ...(modelFilter ? { model: modelFilter } : {}),
  });

  const { data: providersData } = useProviders();

  const isLoading = summaryLoading || recordsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const chartData = (summary?.breakdown ?? []).map((b) => ({
    date: b.key,
    cost: b.costUsd,
    tokens: b.tokensIn + b.tokensOut,
  }));

  const providerNames = [...new Set(providersData?.providers.map((p) => p.name) ?? [])];
  const modelNames = [
    ...new Set(providersData?.providers.flatMap((p) => p.models.map((m) => m.name)) ?? []),
  ];

  const columns = [
    { key: "provider", label: "Provider" },
    { key: "model", label: "Model" },
    {
      key: "tokensIn",
      label: "Tokens In",
      render: (r: Record<string, unknown>) =>
        (r.tokensIn as number).toLocaleString(),
    },
    {
      key: "tokensOut",
      label: "Tokens Out",
      render: (r: Record<string, unknown>) =>
        (r.tokensOut as number).toLocaleString(),
    },
    {
      key: "costUsd",
      label: "Cost",
      render: (r: Record<string, unknown>) =>
        `$${(r.costUsd as number).toFixed(4)}`,
    },
    {
      key: "latencyMs",
      label: "Latency",
      render: (r: Record<string, unknown>) =>
        `${(r.latencyMs as number).toLocaleString()}ms`,
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Usage</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">All Providers</option>
          {providerNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">All Models</option>
          {modelNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {/* KPI Cards */}
      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="Total Cost"
            value={`$${summary.totalCostUsd.toFixed(2)}`}
            icon={DollarSign}
          />
          <KpiCard
            title="Total Tokens"
            value={formatTokens(summary.totalTokensIn + summary.totalTokensOut)}
            subtitle={`In: ${formatTokens(summary.totalTokensIn)} / Out: ${formatTokens(summary.totalTokensOut)}`}
            icon={Hash}
          />
          <KpiCard
            title="Total Requests"
            value={summary.totalRequests.toLocaleString()}
            icon={Zap}
          />
          <KpiCard
            title="Avg Latency"
            value={`${Math.round(summary.avgLatencyMs)}ms`}
            icon={Clock}
          />
        </div>
      )}

      {/* Cost Chart */}
      {chartData.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">Cost Over Time</h2>
          <div className="rounded-lg border border-border bg-card p-4">
            <CostChart data={chartData} type="cost" />
          </div>
        </section>
      )}

      {/* Records Table */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Recent Records</h2>
        {(records?.records ?? []).length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No usage records"
            description="Usage data will appear here after requests are processed."
          />
        ) : (
          <div className="rounded-lg border border-border bg-card">
            <DataTable
              columns={columns}
              data={(records?.records ?? []) as unknown as Record<string, unknown>[]}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}
