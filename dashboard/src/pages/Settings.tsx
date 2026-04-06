import { useState } from "react";
import { Eye, EyeOff, LogOut, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext.tsx";
import { useHealth } from "../api/hooks.ts";
import { useNavigate } from "react-router-dom";

export function SettingsPage() {
  const { user, token, logout } = useAuth();
  const { data: health, isLoading } = useHealth();
  const navigate = useNavigate();
  const [showToken, setShowToken] = useState(false);

  const handleDisconnect = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const maskedToken =
    token && token.length > 8
      ? `${token.slice(0, 4)}${"*".repeat(Math.min(token.length - 8, 24))}${token.slice(-4)}`
      : "****";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>

      {/* API Connection */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Session</h2>
        <div className="space-y-3">
          {user ? (
            <div className="flex items-center gap-3">
              {user.avatar && (
                <img
                  src={user.avatar}
                  alt={user.login}
                  className="h-8 w-8 rounded-full"
                />
              )}
              <div>
                <p className="text-sm font-medium text-foreground">
                  {user.name ?? user.login}
                </p>
                <p className="text-xs text-muted-foreground">@{user.login} via GitHub</p>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs text-muted-foreground">Auth Token</p>
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-foreground">
                  {showToken ? token : maskedToken}
                </code>
                <button
                  onClick={() => setShowToken(!showToken)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground">Gateway</p>
            <p className="text-sm font-medium text-foreground">{window.location.origin}</p>
          </div>
        </div>
      </section>

      {/* Auto-Refresh */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Auto-Refresh</h2>
        <p className="text-sm text-muted-foreground">
          Queries refresh every <span className="font-medium text-foreground">30 seconds</span> (configured in QueryClient defaults).
        </p>
      </section>

      {/* System Info */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        health && (
          <section className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h2 className="text-lg font-semibold text-foreground">System Info</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Version</p>
                <p className="text-sm font-medium text-foreground">{health.version}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Uptime</p>
                <p className="text-sm font-medium text-foreground">
                  {formatUptime(health.uptime)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Heap Used</p>
                <p className="text-sm font-medium text-foreground">
                  {formatBytes(health.memory.heapUsed)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">RSS</p>
                <p className="text-sm font-medium text-foreground">
                  {formatBytes(health.memory.rss)}
                </p>
              </div>
            </div>
          </section>
        )
      )}

      {/* Disconnect */}
      <section>
        <button
          onClick={handleDisconnect}
          className="flex items-center gap-2 rounded-md border border-destructive/50 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
        >
          <LogOut className="h-4 w-4" />
          Disconnect
        </button>
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
