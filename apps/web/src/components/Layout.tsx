import { Suspense } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useTheme } from "../theme.js";
import { useAuth } from "../auth/AuthContext.js";
import { Button, cx, Spinner } from "./ui.js";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/holdings", label: "Holdings" },
  { to: "/transactions", label: "Transactions" },
  { to: "/analytics", label: "Analytics" },
  { to: "/rebalance", label: "Rebalance" },
  { to: "/dividends", label: "Dividends" },
  { to: "/reports", label: "Capital gains" },
  { to: "/assets", label: "Other assets" },
  { to: "/portfolios", label: "Portfolios" },
  { to: "/imports", label: "Imports" },
  { to: "/settings", label: "Settings" },
];

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const order = ["light", "dark", "system"] as const;
  const next = order[(order.indexOf(theme) + 1) % order.length]!;
  const label = { light: "☀", dark: "☾", system: "⚙" }[theme];
  return (
    <button
      onClick={() => setTheme(next)}
      title={`Theme: ${theme} → ${next}`}
      className="grid h-9 w-9 place-items-center rounded-md border text-sm hover:bg-accent"
    >
      {label}
    </button>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="grid min-h-screen grid-cols-[220px_1fr] max-md:grid-cols-1">
      <aside className="border-r bg-sidebar p-4 max-md:hidden">
        <div className="mb-6 flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary font-serif text-primary-foreground">द</div>
          <span className="font-serif text-lg">Dhan Drishti</span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx(
                  "rounded-md px-3 py-2 text-sm",
                  isActive
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="border-b">
          <div className="flex items-center justify-between px-6 py-3 max-sm:px-4">
            {/* Brand shows on mobile only (the sidebar is hidden there). */}
            <div className="flex items-center gap-2 md:hidden">
              <div className="grid h-7 w-7 place-items-center rounded-md bg-primary font-serif text-sm text-primary-foreground">द</div>
              <span className="font-serif">Dhan Drishti</span>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-sm text-muted-foreground max-sm:hidden">{user?.username}</span>
              <ThemeToggle />
              <Button variant="ghost" className="h-9 px-3" onClick={() => void logout()}>
                Sign out
              </Button>
            </div>
          </div>
          {/* Mobile nav gets its own full-width, scrollable row. */}
          <nav className="flex gap-1 overflow-x-auto border-t px-4 py-2 md:hidden">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => cx("whitespace-nowrap rounded-md px-3 py-1.5 text-sm", isActive ? "bg-accent font-medium text-foreground" : "text-muted-foreground")}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="min-w-0 flex-1 p-6 max-sm:p-4">
          <Suspense fallback={<Spinner label="Loading…" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
