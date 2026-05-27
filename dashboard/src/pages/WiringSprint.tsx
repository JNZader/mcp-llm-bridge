import { Shield, Cpu, BarChart3 } from "lucide-react";
import { KpiCard } from "../components/KpiCard.tsx";
import { DataTable } from "../components/DataTable.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import {
  useCompressionStats,
  useLocalModels,
  useSecurityProfile,
} from "../api/hooks.ts";

export function WiringSprintPage() {
  const { data: profile } = useSecurityProfile();
  const { data: localModels } = useLocalModels();
  const { data: compression } = useCompressionStats();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Wiring Sprint</h1>
      <p className="text-sm text-muted-foreground">
        Dashboard for v0.6.0 wired features: security profiles, local LLMs, and
        output compression.
      </p>

      {/* Security Profile */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Security Profile
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <KpiCard
            title="Active Profile"
            value={profile?.profile ?? "—"}
            icon={Shield}
          />
          <KpiCard
            title="Allowed Categories"
            value={profile?.allowedCategories?.join(", ") ?? "—"}
            icon={Shield}
          />
          <KpiCard
            title="Rate Limit"
            value={
              profile?.rateLimit
                ? `${profile.rateLimit.max} req / ${Math.round(profile.rateLimit.windowMs / 60000)} min`
                : "None"
            }
            icon={Shield}
          />
        </div>
      </section>

      {/* Local LLM Models */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Cpu className="h-5 w-5 text-primary" />
          Local LLM Models
        </h2>
        {localModels?.backends?.length ? (
          localModels.backends.map((backend) => (
            <div
              key={backend.backend}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium capitalize">{backend.backend}</span>
                <StatusBadge
                  status={
                    backend.status === "connected" ? "healthy" : "unavailable"
                  }
                />
              </div>
              {backend.models.length > 0 ? (
                <DataTable
                  columns={[
                    { key: "id", label: "Model ID" },
                    { key: "name", label: "Name" },
                    {
                      key: "parameterSize",
                      label: "Parameters",
                      render: (row) => (row.parameterSize ? `${row.parameterSize}B` : "—"),
                    },
                    {
                      key: "loaded",
                      label: "Loaded",
                      render: (row) => (row.loaded ? "Yes" : "No"),
                    },
                  ]}
                  data={backend.models as Record<string, unknown>[]}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No models detected on this backend.
                </p>
              )}
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            No local LLM backends detected. Enable with{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              LOCAL_LLM_ENABLED=true
            </code>
            .
          </div>
        )}
      </section>

      {/* Compression Stats */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          Compression Stats
        </h2>
        <div className="grid gap-4 md:grid-cols-4">
          <KpiCard
            title="Total Calls"
            value={compression?.totalCalls ?? 0}
            icon={BarChart3}
          />
          <KpiCard
            title="Compressed Calls"
            value={compression?.compressedCalls ?? 0}
            icon={BarChart3}
          />
          <KpiCard
            title="Avg Ratio"
            value={
              compression?.avgRatio !== undefined
                ? `${(compression.avgRatio * 100).toFixed(1)}%`
                : "—"
            }
            icon={BarChart3}
          />
          <KpiCard
            title="Chars Saved"
            value={compression?.totalSavingsChars ?? 0}
            icon={BarChart3}
          />
        </div>
      </section>
    </div>
  );
}
