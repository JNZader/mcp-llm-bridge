import { useState } from "react";
import { Server, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { useProviders } from "../api/hooks.ts";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import type { ProviderDetail } from "../api/types.ts";

export function Providers() {
  const { data, isLoading, error } = useProviders();
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
        Failed to load providers: {error.message}
      </div>
    );
  }

  const providers = data?.providers ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Providers</h1>

      {providers.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No providers found"
          description="Configure providers in your gateway to see them here."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {providers.map((provider) => (
            <ProviderExpandableCard
              key={provider.id}
              provider={provider}
              expanded={expandedId === provider.id}
              onToggle={() =>
                setExpandedId(expandedId === provider.id ? null : provider.id)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderExpandableCard({
  provider,
  expanded,
  onToggle,
}: {
  provider: ProviderDetail;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Chevron = expanded ? ChevronUp : ChevronDown;

  return (
    <div className="rounded-lg border border-border bg-card transition-colors hover:border-primary/30">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between p-4 text-left"
      >
        <div>
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">{provider.name}</h3>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge status={provider.available ? "available" : "unavailable"} />
            <StatusBadge status={provider.circuitBreaker.state} variant="outline" />
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground uppercase">
              {provider.type}
            </span>
          </div>
        </div>
        <Chevron className="h-4 w-4 text-muted-foreground" />
      </button>

      {expanded && (
        <div className="border-t border-border p-4 space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Models</p>
            {provider.models.length === 0 ? (
              <p className="text-xs text-muted-foreground/70">No models registered</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {provider.models.map((m) => (
                  <span
                    key={m.id}
                    className="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground"
                  >
                    {m.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Circuit Breaker</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Failures: </span>
                <span className="text-foreground">{provider.circuitBreaker.failures}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Consecutive: </span>
                <span className="text-foreground">{provider.circuitBreaker.consecutiveFailures}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
