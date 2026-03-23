import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  type TooltipProps,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";

interface CostDataPoint {
  date: string;
  cost: number;
  tokens: number;
}

interface CostChartProps {
  data: CostDataPoint[];
  type: "cost" | "tokens";
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function ChartTooltip({ active, payload, label }: TooltipProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null;

  const entry = payload[0];
  const value = entry.value as number;
  const dataKey = entry.dataKey as string;
  const formatted = dataKey === "cost" ? formatCost(value) : formatTokens(value);

  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 shadow-lg">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground">{formatted}</p>
    </div>
  );
}

export function CostChart({ data, type }: CostChartProps) {
  const dataKey = type === "cost" ? "cost" : "tokens";
  const formatter = type === "cost" ? formatCost : formatTokens;
  const color = type === "cost" ? "#3b82f6" : "#22c55e";

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`gradient-${type}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatter}
            tick={{ fontSize: 12, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            fill={`url(#gradient-${type})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
