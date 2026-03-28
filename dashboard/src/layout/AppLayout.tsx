import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Server,
  BarChart3,
  Users,
  ShieldAlert,
  Settings,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { cn } from "../lib/utils.ts";
import { useAuth } from "../context/AuthContext.tsx";

const NAV_ITEMS = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/providers", label: "Providers", icon: Server },
  { to: "/usage", label: "Usage", icon: BarChart3 },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/circuit-breakers", label: "Circuit Breakers", icon: ShieldAlert },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { logout } = useAuth();

  return (
    <div className="flex min-h-svh">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card transition-transform md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Server className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            MCP LLM Bridge
          </span>
          <button
            className="ml-auto md:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Disconnect
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center border-b border-border px-4 md:hidden">
          <button onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5 text-muted-foreground" />
          </button>
          <span className="ml-3 text-sm font-semibold text-foreground">
            MCP LLM Bridge
          </span>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
