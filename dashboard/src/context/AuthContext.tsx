import { createContext, use, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

interface AuthState {
  token: string;
  baseUrl: string;
}

interface AuthContextValue {
  token: string | null;
  baseUrl: string | null;
  isAuthenticated: boolean;
  login: (token: string, baseUrl: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function getStoredAuth(): AuthState | null {
  const token = sessionStorage.getItem("auth_token");
  const baseUrl = sessionStorage.getItem("gateway_url");
  if (token && baseUrl) {
    return { token, baseUrl };
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(getStoredAuth);

  const login = (token: string, baseUrl: string) => {
    sessionStorage.setItem("auth_token", token);
    sessionStorage.setItem("gateway_url", baseUrl);
    setAuth({ token, baseUrl });
  };

  const logout = () => {
    sessionStorage.removeItem("auth_token");
    sessionStorage.removeItem("gateway_url");
    setAuth(null);
  };

  const value: AuthContextValue = {
    token: auth?.token ?? null,
    baseUrl: auth?.baseUrl ?? null,
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
