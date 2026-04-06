import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, AlertCircle } from "lucide-react";
import { useAuth } from "../context/AuthContext.tsx";

export function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    const err = searchParams.get("error");

    if (err) {
      setError(decodeURIComponent(err));
      return;
    }

    if (!token) {
      setError("No token received from GitHub OAuth.");
      return;
    }

    login(token);
    navigate("/", { replace: true });
  }, [searchParams, login, navigate]);

  if (error) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="text-xl font-bold text-foreground">
            Authentication Failed
          </h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <a
            href="#/login"
            className="inline-block text-sm text-primary underline hover:text-primary/80"
          >
            Back to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Completing login…</p>
      </div>
    </div>
  );
}
