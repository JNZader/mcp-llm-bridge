import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, ProtectedRoute } from "./context/AuthContext.tsx";
import { AppLayout } from "./layout/AppLayout.tsx";
import { Login } from "./pages/Login.tsx";
import { Overview } from "./pages/Overview.tsx";
import { Providers } from "./pages/Providers.tsx";
import { Usage } from "./pages/Usage.tsx";
import { Groups } from "./pages/Groups.tsx";
import { CircuitBreakers } from "./pages/CircuitBreakers.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { OAuthCallback } from "./pages/OAuthCallback.tsx";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 30_000,
      staleTime: 10_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/oauth/callback" element={<OAuthCallback />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Overview />} />
              <Route path="providers" element={<Providers />} />
              <Route path="usage" element={<Usage />} />
              <Route path="groups" element={<Groups />} />
              <Route path="circuit-breakers" element={<CircuitBreakers />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </AuthProvider>
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>
);
