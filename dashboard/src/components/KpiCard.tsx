import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils.ts";

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  className?: string;
}

export function KpiCard({ title, value, subtitle, icon: Icon, className }: KpiCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/30",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      {subtitle && (
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
