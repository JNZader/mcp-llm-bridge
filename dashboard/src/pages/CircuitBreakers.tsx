import { ShieldAlert, Loader2, RotateCcw } from "lucide-react";
import { useCBStats, useCBConfig, useResetCircuitBreaker } from "../api/hooks.ts";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { DataTable } from "../components/DataTable.tsx";
import { EmptyState } from "../components/EmptyState.tsx";

export function CircuitBreakers() {
  const { data: stats, isLoading: statsLoading, error: statsError } = useCBStats();
  const { data: config } = useCBConfig();
  const resetCB = useResetCircuitBreaker();

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (statsError) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load circuit breakers: {statsError.message}
      </div>
    );
  }

  const breakers = stats?.breakers ?? [];

  const columns = [
    { key: "name", label: "Provider" },
    {
      key: "state",
      label: "State",
      render: (row: Record<string, unknown>) => (
        <StatusBadge status={row.state as string} />
      ),
    },
    {
      key: "failures",
      label: "Failures",
      render: (row: Record<string, unknown>) => String(row.failures),
    },
    {
      key: "successes",
      label: "Successes",
      render: (row: Record<string, unknown>) => String(row.successes),
    },
    {
      key: "consecutiveFailures",
      label: "Consecutive",
      render: (row: Record<string, unknown>) => String(row.consecutiveFailures),
    },
    {
      key: "lastFailureTime",
      label: "Last Failure",
      render: (row: Record<string, unknown>) => {
        const ts = row.lastFailureTime as number;
        return ts > 0 ? new Date(ts).toLocaleString() : "Never";
      },
    },
    {
      key: "currentCooldownMs",
      label: "Cooldown",
      render: (row: Record<string, unknown>) => {
        const ms = row.currentCooldownMs as number;
        return ms > 0 ? `${(ms / 1000).toFixed(1)}s` : "-";
      },
    },
    {
      key: "actions",
      label: "",
      render: (row: Record<string, unknown>) => (
        <button
          onClick={() => resetCB.mutate(row.name as string)}
          disabled={resetCB.isPending}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/10"
          title="Reset circuit breaker"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Circuit Breakers</h1>

      {!stats?.enabled && (
        <div className="rounded-md border border-warning/50 bg-warning/10 px-4 py-2 text-sm text-warning">
          Circuit breakers are currently disabled.
        </div>
      )}

      {breakers.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title="No circuit breakers"
          description="Circuit breaker stats will appear when providers have been accessed."
        />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <DataTable
            columns={columns}
            data={breakers as unknown as Record<string, unknown>[]}
          />
        </div>
      )}

      {/* Config Section */}
      {config && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">Configuration</h2>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <ConfigItem label="Enabled" value={config.enabled ? "Yes" : "No"} />
              <ConfigItem label="Failure Threshold" value={String(config.failureThreshold)} />
              <ConfigItem label="Backoff Base" value={`${config.backoffBaseMs}ms`} />
              <ConfigItem label="Backoff Multiplier" value={`${config.backoffMultiplier}x`} />
              <ConfigItem label="Backoff Max" value={`${(config.backoffMaxMs / 1000).toFixed(0)}s`} />
              <ConfigItem label="Reset Timeout" value={`${(config.resetTimeoutMs / 1000).toFixed(0)}s`} />
              <ConfigItem label="Half-Open Threshold" value={String(config.halfOpenSuccessThreshold)} />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
