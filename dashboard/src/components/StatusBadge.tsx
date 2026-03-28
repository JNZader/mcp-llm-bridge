import { cn } from "../lib/utils.ts";

const STATUS_COLORS: Record<string, string> = {
  available: "bg-success/15 text-success border-success/30",
  unavailable: "bg-destructive/15 text-destructive border-destructive/30",
  degraded: "bg-warning/15 text-warning border-warning/30",
  CLOSED: "bg-success/15 text-success border-success/30",
  OPEN: "bg-destructive/15 text-destructive border-destructive/30",
  HALF_OPEN: "bg-warning/15 text-warning border-warning/30",
};

const OUTLINE_COLORS: Record<string, string> = {
  available: "text-success border-success/50 bg-transparent",
  unavailable: "text-destructive border-destructive/50 bg-transparent",
  degraded: "text-warning border-warning/50 bg-transparent",
  CLOSED: "text-success border-success/50 bg-transparent",
  OPEN: "text-destructive border-destructive/50 bg-transparent",
  HALF_OPEN: "text-warning border-warning/50 bg-transparent",
};

interface StatusBadgeProps {
  status: string;
  variant?: "default" | "outline";
}

export function StatusBadge({ status, variant = "default" }: StatusBadgeProps) {
  const colorMap = variant === "outline" ? OUTLINE_COLORS : STATUS_COLORS;
  const colors = colorMap[status] ?? "bg-muted text-muted-foreground border-border";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        colors,
      )}
    >
      {status}
    </span>
  );
}
