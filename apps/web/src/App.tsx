import { lazy, Suspense, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { queryClient } from "./lib/query.js";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import { FilterProvider } from "./lib/hooks.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { Landing } from "./pages/Landing.js";
import { AppShell } from "@/components/shell/AppShell";
import { Section } from "@/components/shell/Section";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

// Pages are code-split so the landing page doesn't download the whole app.
const Home = lazy(() => import("@/pages/home/Home").then((m) => ({ default: m.Home })));
const Positions = lazy(() => import("@/pages/portfolio/Positions").then((m) => ({ default: m.Positions })));
const Allocation = lazy(() => import("@/pages/portfolio/Allocation").then((m) => ({ default: m.Allocation })));
const Activity = lazy(() => import("@/pages/activity/Activity").then((m) => ({ default: m.Activity })));
const Returns = lazy(() => import("@/pages/performance/Returns").then((m) => ({ default: m.Returns })));
const Rebalance = lazy(() => import("@/pages/performance/Rebalance").then((m) => ({ default: m.Rebalance })));
const Dividends = lazy(() => import("@/pages/activity/Dividends").then((m) => ({ default: m.Dividends })));
const Tax = lazy(() => import("@/pages/performance/Tax").then((m) => ({ default: m.Tax })));
const Security = lazy(() => import("@/pages/portfolio/Security").then((m) => ({ default: m.Security })));
const OtherAssets = lazy(() => import("@/pages/portfolio/OtherAssets").then((m) => ({ default: m.OtherAssets })));
const Health = lazy(() => import("@/pages/portfolio/Health").then((m) => ({ default: m.Health })));
const People = lazy(() => import("@/pages/accounts/People").then((m) => ({ default: m.People })));
const Imports = lazy(() => import("./pages/Imports.js").then((m) => ({ default: m.Imports })));
const AddData = lazy(() => import("@/pages/accounts/AddData").then((m) => ({ default: m.AddData })));
const Attention = lazy(() => import("@/pages/accounts/Attention").then((m) => ({ default: m.Attention })));
const AttentionCount = lazy(() => import("@/pages/accounts/Attention").then((m) => ({ default: m.AttentionCount })));
const News = lazy(() => import("@/pages/news/News").then((m) => ({ default: m.News })));
const Research = lazy(() => import("@/pages/research/Research").then((m) => ({ default: m.Research })));
const Settings = lazy(() => import("./pages/Settings.js").then((m) => ({ default: m.Settings })));

function PageFallback() {
  return <Skeleton className="h-[420px] rounded-2xl" />;
}

/** Old links (bookmarks, history) still land somewhere sensible. */
function LegacySecurity() {
  const { id } = useParams();
  return <Navigate to={`/portfolio/security/${id ?? ""}`} replace />;
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <span className="font-display text-5xl text-muted-foreground">द</span>
      </div>
    );
  }
  if (!user) return <Landing />;
  return (
    <FilterProvider>
        <BrowserRouter>
          <Suspense fallback={null}>
            <Routes>
              <Route element={<AppShell />}>
                <Route
                  index
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <Home />
                    </Suspense>
                  }
                />
                <Route
                  path="portfolio"
                  element={
                    <Section
                      title="Portfolio"
                      lead="What you own, grouped by kind and priced."
                      tabs={[
                        { label: "Positions", to: "/portfolio", end: true },
                        { label: "Allocation", to: "/portfolio/allocation" },
                        { label: "Health", to: "/portfolio/health" },
                        { label: "Other assets", to: "/portfolio/other" },
                      ]}
                    />
                  }
                >
                  <Route index element={<Lazy><Positions /></Lazy>} />
                  <Route path="allocation" element={<Lazy><Allocation /></Lazy>} />
                  <Route path="health" element={<Lazy><Health /></Lazy>} />
                  <Route path="other" element={<Lazy><OtherAssets /></Lazy>} />
                </Route>
                <Route path="portfolio/security/:id" element={<Lazy><Security /></Lazy>} />
                <Route
                  path="activity"
                  element={
                    <Section
                      title="Activity"
                      lead="Everything that happened: trades, income and cash."
                      tabs={[
                        { label: "Timeline", to: "/activity", end: true },
                        { label: "Dividends", to: "/activity/income" },
                      ]}
                    />
                  }
                >
                  <Route index element={<Lazy><Activity /></Lazy>} />
                  <Route path="income" element={<Lazy><Dividends /></Lazy>} />
                </Route>
                <Route
                  path="performance"
                  element={
                    <Section
                      title="Performance"
                      lead="How your money is doing, what you owe in tax, and how to rebalance."
                      tabs={[
                        { label: "Returns", to: "/performance", end: true },
                        { label: "Tax", to: "/performance/tax" },
                        { label: "Rebalance", to: "/performance/rebalance" },
                      ]}
                    />
                  }
                >
                  <Route index element={<Lazy><Returns /></Lazy>} />
                  <Route path="tax" element={<Lazy><Tax /></Lazy>} />
                  <Route path="rebalance" element={<Lazy><Rebalance /></Lazy>} />
                </Route>
                <Route
                  path="accounts"
                  element={
                    <Section
                      title="Accounts"
                      lead="Where your data comes from: add files, manage brokers and family."
                      tabs={[
                        { label: "Add data", to: "/accounts", end: true },
                        {
                          label: "Needs attention",
                          to: "/accounts/attention",
                          badge: (
                            <Suspense fallback={null}>
                              <AttentionCount />
                            </Suspense>
                          ),
                        },
                        { label: "People & accounts", to: "/accounts/portfolios" },
                        { label: "Manual import", to: "/accounts/manual" },
                      ]}
                    />
                  }
                >
                  <Route index element={<Lazy><AddData /></Lazy>} />
                  <Route path="attention" element={<Lazy><Attention /></Lazy>} />
                  <Route path="portfolios" element={<Lazy><People /></Lazy>} />
                  <Route path="manual" element={<Lazy><Imports /></Lazy>} />
                </Route>
                <Route path="news" element={<Lazy><News /></Lazy>} />
                <Route path="research" element={<Lazy><Research /></Lazy>} />
                <Route path="research/:id" element={<Lazy><Research /></Lazy>} />
                <Route path="research/t/:ticker" element={<Lazy><Research /></Lazy>} />
                <Route path="settings" element={<Lazy><Settings /></Lazy>} />

                {/* Old addresses */}
                <Route path="holdings" element={<Navigate to="/portfolio" replace />} />
                <Route path="assets" element={<Navigate to="/portfolio/other" replace />} />
                <Route path="security/:id" element={<LegacySecurity />} />
                <Route path="transactions" element={<Navigate to="/activity" replace />} />
                <Route path="dividends" element={<Navigate to="/activity/income" replace />} />
                <Route path="analytics" element={<Navigate to="/performance" replace />} />
                <Route path="reports" element={<Navigate to="/performance/tax" replace />} />
                <Route path="rebalance" element={<Navigate to="/performance/rebalance" replace />} />
                <Route path="imports" element={<Navigate to="/accounts" replace />} />
                <Route path="portfolios" element={<Navigate to="/accounts/portfolios" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
    </FilterProvider>
  );
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={250}>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
