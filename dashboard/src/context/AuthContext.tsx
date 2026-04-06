import { createContext, use, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

interface GithubUser {
  login: string;
  name: string | null;
  avatar: string | null;
}

interface AuthState {
  token: string;
  user?: GithubUser;
}

interface AuthContextValue {
  token: string | null;
  user: GithubUser | null;
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function decodeJwtPayload(token: string): GithubUser | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (payload?.login) {
      return {
        login: payload.login as string,
        name: (payload.name as string | null) ?? null,
        avatar: (payload.avatar as string | null) ?? null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function getStoredAuth(): AuthState | null {
  const token = sessionStorage.getItem("auth_token");
  if (!token) return null;
  const user = decodeJwtPayload(token) ?? undefined;
  return { token, user };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(getStoredAuth);

  const login = (token: string) => {
    sessionStorage.setItem("auth_token", token);
    const user = decodeJwtPayload(token) ?? undefined;
    setAuth({ token, user });
  };

  const logout = () => {
    sessionStorage.removeItem("auth_token");
    setAuth(null);
  };

  const value: AuthContextValue = {
    token: auth?.token ?? null,
    user: auth?.user ?? null,
    isAuthenticated: auth !== null,
    login,
    logout,
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
