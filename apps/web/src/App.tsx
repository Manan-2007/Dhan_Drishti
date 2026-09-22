import { lazy } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { queryClient } from "./lib/query.js";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import { FilterProvider } from "./lib/hooks.js";
import { ToastProvider } from "./components/Toast.js";
import { Layout } from "./components/Layout.js";
import { Landing } from "./pages/Landing.js";
import { Spinner } from "./components/ui.js";

// The authenticated pages are code-split so the initial load (Landing) doesn't pull in the whole
// app — Recharts and the chart-heavy pages only download when a signed-in user navigates to them.
// (Named exports, so map each module to a default for React.lazy.)
const Dashboard = lazy(() => import("./pages/Dashboard.js").then((m) => ({ default: m.Dashboard })));
const Holdings = lazy(() => import("./pages/Holdings.js").then((m) => ({ default: m.Holdings })));
const Transactions = lazy(() => import("./pages/Transactions.js").then((m) => ({ default: m.Transactions })));
const Analytics = lazy(() => import("./pages/Analytics.js").then((m) => ({ default: m.Analytics })));
const Rebalance = lazy(() => import("./pages/Rebalance.js").then((m) => ({ default: m.Rebalance })));
const Dividends = lazy(() => import("./pages/Dividends.js").then((m) => ({ default: m.Dividends })));
const Reports = lazy(() => import("./pages/Reports.js").then((m) => ({ default: m.Reports })));
const SecurityDetail = lazy(() => import("./pages/SecurityDetail.js").then((m) => ({ default: m.SecurityDetail })));
const ManualAssets = lazy(() => import("./pages/ManualAssets.js").then((m) => ({ default: m.ManualAssets })));
const Portfolios = lazy(() => import("./pages/Portfolios.js").then((m) => ({ default: m.Portfolios })));
const Imports = lazy(() => import("./pages/Imports.js").then((m) => ({ default: m.Imports })));
const Settings = lazy(() => import("./pages/Settings.js").then((m) => ({ default: m.Settings })));

function Gate() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Loading Dhan Drishti…" />
      </div>
    );
  }
  if (!user) return <Landing />;
  return (
    <FilterProvider>
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="holdings" element={<Holdings />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="rebalance" element={<Rebalance />} />
            <Route path="dividends" element={<Dividends />} />
            <Route path="reports" element={<Reports />} />
            <Route path="security/:id" element={<SecurityDetail />} />
            <Route path="assets" element={<ManualAssets />} />
            <Route path="portfolios" element={<Portfolios />} />
            <Route path="imports" element={<Imports />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </FilterProvider>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </QueryClientProvider>
  );
}
