import { Activity, Server, Zap, DollarSign, Loader2 } from "lucide-react";
import { useOverview } from "../api/hooks.ts";
import { useHealth } from "../api/hooks.ts";
import { KpiCard } from "../components/KpiCard.tsx";
import { ProviderCard } from "../components/ProviderCard.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { EmptyState } from "../components/EmptyState.tsx";

export function Overview() {
  const { data: overview, isLoading, error } = useOverview();
  const { data: health } = useHealth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load overview: {error.message}
      </div>
    );
  }

  if (!overview) return null;

  const availableProviders = overview.providers.filter((p) => p.available).length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Overview</h1>

      {/* KPI Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Providers"
          value={overview.providers.length}
          subtitle={`${availableProviders} available`}
          icon={Server}
        />
        <KpiCard
          title="Available Providers"
          value={availableProviders}
          subtitle={`of ${overview.providers.length} total`}
          icon={Activity}
        />
        <KpiCard
          title="Requests (24h)"
          value={overview.usage.totalRequests.toLocaleString()}
          icon={Zap}
        />
        <KpiCard
          title="Cost (24h)"
          value={`$${overview.usage.totalCost.toFixed(2)}`}
          subtitle={`${overview.usage.totalTokens.toLocaleString()} tokens`}
          icon={DollarSign}
        />
      </div>

      {/* Provider Status Grid */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Provider Status</h2>
        {overview.providers.length === 0 ? (
          <EmptyState icon={Server} title="No providers configured" />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {overview.providers.map((p) => (
              <ProviderCard
                key={p.id}
                name={p.name}
                type={p.type}
                available={p.available}
                modelCount={0}
                circuitBreakerState="CLOSED"
              />
            ))}
          </div>
        )}
      </section>

      {/* System Health */}
      {health && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">System Health</h2>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <StatusBadge status={health.status === "ok" ? "available" : "degraded"} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Database</p>
                <StatusBadge status={health.database.connected ? "available" : "unavailable"} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Uptime</p>
                <p className="text-sm font-medium text-foreground">
                  {formatUptime(health.uptime)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Memory (Heap)</p>
                <p className="text-sm font-medium text-foreground">
                  {formatBytes(health.memory.heapUsed)}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Circuit Breaker Summary */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Circuit Breakers</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-card p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{overview.circuitBreakers.total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-center">
            <p className="text-2xl font-bold text-success">{overview.circuitBreakers.closed}</p>
            <p className="text-xs text-muted-foreground">Closed</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-center">
            <p className="text-2xl font-bold text-destructive">{overview.circuitBreakers.open}</p>
            <p className="text-xs text-muted-foreground">Open</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-center">
            <p className="text-2xl font-bold text-warning">{overview.circuitBreakers.halfOpen}</p>
            <p className="text-xs text-muted-foreground">Half Open</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
