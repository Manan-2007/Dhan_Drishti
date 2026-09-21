import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { queryClient } from "./lib/query.js";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import { FilterProvider } from "./lib/hooks.js";
import { Layout } from "./components/Layout.js";
import { Landing } from "./pages/Landing.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Holdings } from "./pages/Holdings.js";
import { Transactions } from "./pages/Transactions.js";
import { Analytics } from "./pages/Analytics.js";
import { Rebalance } from "./pages/Rebalance.js";
import { Dividends } from "./pages/Dividends.js";
import { Goals } from "./pages/Goals.js";
import { Portfolios } from "./pages/Portfolios.js";
import { Imports } from "./pages/Imports.js";
import { Settings } from "./pages/Settings.js";
import { Spinner } from "./components/ui.js";

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
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="holdings" element={<Holdings />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="rebalance" element={<Rebalance />} />
            <Route path="dividends" element={<Dividends />} />
            <Route path="goals" element={<Goals />} />
            <Route path="portfolios" element={<Portfolios />} />
            <Route path="imports" element={<Imports />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
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
