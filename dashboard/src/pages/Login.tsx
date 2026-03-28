import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Server, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext.tsx";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [baseUrl, setBaseUrl] = useState(
    () => sessionStorage.getItem("gateway_url") || window.location.origin || "http://localhost:3456"
  );
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const url = baseUrl.replace(/\/+$/, "");
      const response = await fetch(`${url}/v1/admin/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setError("Invalid admin token. Check your ADMIN_TOKEN configuration.");
        } else {
          setError(`Server returned ${response.status}: ${response.statusText}`);
        }
        return;
      }

      login(token, url);
      navigate("/", { replace: true });
    } catch {
      setError("Could not connect to the gateway. Verify the URL and that the server is running.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <Server className="h-10 w-10 text-primary" />
          <h1 className="text-xl font-bold text-foreground">MCP LLM Bridge</h1>
          <p className="text-sm text-muted-foreground">
            Connect to your gateway to access the dashboard.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="baseUrl"
              className="block text-sm font-medium text-foreground"
            >
              Gateway URL
            </label>
            <input
              id="baseUrl"
              type="url"
              required
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:3456"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

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
                Connecting...
              </>
            ) : (
              "Connect"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
