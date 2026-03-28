import { Server, Terminal } from "lucide-react";
import { StatusBadge } from "./StatusBadge.tsx";
import { cn } from "../lib/utils.ts";

interface ProviderCardProps {
  name: string;
  type: "api" | "cli";
  available: boolean;
  modelCount: number;
  circuitBreakerState: string;
  className?: string;
  onClick?: () => void;
}

export function ProviderCard({
  name,
  type,
  available,
  modelCount,
  circuitBreakerState,
  className,
  onClick,
}: ProviderCardProps) {
  const TypeIcon = type === "api" ? Server : Terminal;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/30",
        onClick && "cursor-pointer",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <TypeIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{name}</h3>
        </div>
        <StatusBadge status={available ? "available" : "unavailable"} />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {modelCount} model{modelCount !== 1 ? "s" : ""}
        </span>
        <StatusBadge status={circuitBreakerState} variant="outline" />
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground uppercase">
          {type}
        </span>
      </div>
    </button>
  );
}
