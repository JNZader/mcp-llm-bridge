import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Server, Loader2, ChevronDown } from "lucide-react";
import { useAuth } from "../context/AuthContext.tsx";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

interface AuthConfig {
  githubOauth: boolean;
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/v1/admin/auth-config")
      .then((r) => r.json())
      .then((data: AuthConfig) => setAuthConfig(data))
      .catch(() => setAuthConfig({ githubOauth: false }));
  }, []);

  const handleGithubLogin = () => {
    window.location.href = "/auth/github";
  };

  const handleTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/v1/admin/health", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        setError(
          response.status === 401 || response.status === 403
            ? "Invalid admin token."
            : `Server returned ${response.status}`,
        );
        return;
      }
      login(token);
      navigate("/", { replace: true });
    } catch {
      setError("Could not connect to the gateway.");
    } finally {
      setLoading(false);
    }
  };

  // When no GitHub OAuth, show the token form directly (no extra click needed)
  const githubConfigured = authConfig?.githubOauth ?? false;

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <Server className="h-10 w-10 text-primary" />
          <h1 className="text-xl font-bold text-foreground">MCP LLM Bridge</h1>
          <p className="text-sm text-muted-foreground text-center">
            Sign in to access the gateway dashboard.
          </p>
        </div>

        {/* Primary: GitHub OAuth */}
        {githubConfigured && (
          <button
            onClick={handleGithubLogin}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
          >
            <GithubIcon className="h-4 w-4" />
            Continue with GitHub
          </button>
        )}

        {/* Fallback: token form — collapsible when GitHub is available */}
        {githubConfigured ? (
          <div>
            <button
              type="button"
              onClick={() => setShowTokenForm(!showTokenForm)}
              className="flex w-full items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Use admin token
              <ChevronDown
                className={`h-3 w-3 transition-transform ${showTokenForm ? "rotate-180" : ""}`}
              />
            </button>

            {showTokenForm && (
              <form onSubmit={handleTokenSubmit} className="mt-3 space-y-3">
                <input
                  type="password"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Enter your ADMIN_TOKEN"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {error && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Connecting…
                    </>
                  ) : (
                    "Connect"
                  )}
                </button>
              </form>
            )}
          </div>
        ) : (
          /* No GitHub OAuth — show token form directly */
          authConfig !== null && (
            <form onSubmit={handleTokenSubmit} className="space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="token"
                  className="block text-sm font-medium text-foreground"
                >
                  Admin Token
                </label>
                <input
                  id="token"
                  type="password"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Enter your ADMIN_TOKEN"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              {error && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Connecting…
                  </>
                ) : (
                  "Connect"
                )}
              </button>
            </form>
          )
        )}
      </div>
    </div>
  );
}
