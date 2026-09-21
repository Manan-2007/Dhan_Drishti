import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Portfolio, type Account, type HoldingsResponse, type Transaction, type ImportBatch, type NetWorthSeries } from "./api.js";

export type NetWorthRange = "1m" | "3m" | "6m" | "1y" | "max";
export function useNetWorth(portfolioId: string | null, range: NetWorthRange) {
  const search = new URLSearchParams({ range });
  if (portfolioId) search.set("portfolioId", portfolioId);
  return useQuery({
    queryKey: ["networth", portfolioId, range],
    queryFn: () => api.get<NetWorthSeries>(`/api/performance/networth?${search.toString()}`),
  });
}

export function usePortfolios() {
  return useQuery({
    queryKey: ["portfolios"],
    queryFn: () => api.get<{ portfolios: Portfolio[] }>("/api/portfolios").then((r) => r.portfolios),
  });
}

export function useAccounts(portfolioId: string | null) {
  const qs = portfolioId ? `?portfolioId=${portfolioId}` : "";
  return useQuery({
    enabled: !!portfolioId,
    queryKey: ["accounts", portfolioId],
    queryFn: () => api.get<{ accounts: Account[] }>(`/api/accounts${qs}`).then((r) => r.accounts),
  });
}

export function useHoldings(portfolioId: string | null) {
  const qs = portfolioId ? `?portfolioId=${portfolioId}` : "";
  return useQuery({
    queryKey: ["holdings", portfolioId],
    queryFn: () => api.get<HoldingsResponse>(`/api/holdings${qs}`),
  });
}

export function useTransactions(params: { portfolioId: string | null; type?: string; limit?: number }) {
  const search = new URLSearchParams();
  if (params.portfolioId) search.set("portfolioId", params.portfolioId);
  if (params.type) search.set("type", params.type);
  search.set("limit", String(params.limit ?? 100));
  return useQuery({
    queryKey: ["transactions", params],
    queryFn: () =>
      api.get<{ transactions: Transaction[]; total: number }>(`/api/transactions?${search.toString()}`),
  });
}

export interface PerformanceSummary {
  summary: {
    invested: string;
    currentValue: string;
    unrealisedPnl: string;
    realisedPnl: string;
    dividends: string;
    netPnl: string;
    openPositions: number;
    allPriced: boolean;
  };
  xirr: number | null;
  xirrAvailable: boolean;
  byFY: { key: string; realised: string; dividends: string }[];
  byMonth: { key: string; realised: string; dividends: string }[];
  bySegment: { key: string; realised: string }[];
}

export function usePerformance(portfolioId: string | null) {
  const qs = portfolioId ? `?portfolioId=${portfolioId}` : "";
  return useQuery({
    queryKey: ["performance", portfolioId],
    queryFn: () => api.get<PerformanceSummary>(`/api/performance/summary${qs}`),
  });
}

export interface BenchmarkComparison {
  benchmarkId: string;
  label: string;
  symbol: string;
  available: boolean;
  reason?: string;
  from?: string;
  asOf?: string;
  currencyNote?: string;
  currency?: string;
  series?: { date: string; invested: number; index: number }[];
  portfolio: { xirr: number | null; currentValue: string; investedNet: string } | null;
  index: {
    xirr: number | null;
    currentValue: string;
    investedNet: string;
    gain: string;
    matchedFlows: number;
    unmatchedFlows: number;
    latestClose: number;
  } | null;
}

export interface TwrResponse {
  available: boolean;
  mode?: "holdings" | "cash-inclusive";
  reason?: string;
  from?: string;
  asOf?: string;
  twr?: number | null;
  annualized?: number | null;
  subPeriods?: number;
  missingHistory?: string[];
}

export function useTwr(portfolioId: string | null, enabled: boolean) {
  const qs = portfolioId ? `?portfolioId=${portfolioId}` : "";
  return useQuery({
    enabled,
    staleTime: 60_000,
    queryKey: ["twr", portfolioId],
    queryFn: () => api.get<TwrResponse>(`/api/performance/twr${qs}`),
  });
}

export function useBenchmarks() {
  return useQuery({
    queryKey: ["benchmarks"],
    queryFn: () =>
      api.get<{ benchmarks: { id: string; label: string }[] }>("/api/performance/benchmarks").then((r) => r.benchmarks),
  });
}

export function useBenchmark(portfolioId: string | null, benchmarkId: string | null) {
  const search = new URLSearchParams();
  if (portfolioId) search.set("portfolioId", portfolioId);
  if (benchmarkId) search.set("benchmark", benchmarkId);
  return useQuery({
    enabled: !!benchmarkId,
    queryKey: ["benchmark", portfolioId, benchmarkId],
    queryFn: () => api.get<BenchmarkComparison>(`/api/performance/benchmark?${search.toString()}`),
  });
}

export interface DividendsResponse {
  baseCurrency: string;
  fxComplete: boolean;
  unconvertibleCurrencies: string[];
  total: string;
  count: number;
  byFY: { key: string; amount: string }[];
  bySecurity: { symbol: string; name: string; amount: string }[];
  events: {
    id: string;
    type: "dividend" | "interest";
    tradeDate: string;
    amount: string;
    currency: string;
    baseAmount: string | null;
    security: { id: string; symbol: string; name: string } | null;
  }[];
}

export function useDividends(portfolioId: string | null) {
  const qs = portfolioId ? `?portfolioId=${portfolioId}` : "";
  return useQuery({
    queryKey: ["dividends", portfolioId],
    queryFn: () => api.get<DividendsResponse>(`/api/dividends${qs}`),
  });
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: string;
  targetDate: string | null;
  currency: string;
  portfolioIds: string[];
  funded: string;
  remaining: string;
  progress: string | null;
  basis: "current_value" | "invested";
  monthsRemaining: number | null;
  requiredMonthly: string | null;
  reached: boolean;
}

export function useGoals() {
  return useQuery({
    queryKey: ["goals"],
    queryFn: () => api.get<{ goals: Goal[] }>("/api/goals").then((r) => r.goals),
  });
}

export function useImports() {
  return useQuery({
    queryKey: ["imports"],
    queryFn: () => api.get<{ imports: ImportBatch[] }>("/api/imports").then((r) => r.imports),
  });
}

// ---- Selected-portfolio filter (persisted per browser) ----
interface FilterCtx {
  portfolioId: string | null; // null = All portfolios
  setPortfolioId: (id: string | null) => void;
}
const Ctx = createContext<FilterCtx | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [portfolioId, setId] = useState<string | null>(() => {
    try {
      const v = localStorage.getItem("dd-portfolio");
      return v && v !== "all" ? v : null;
    } catch {
      return null;
    }
  });
  const setPortfolioId = (id: string | null) => {
    setId(id);
    try {
      localStorage.setItem("dd-portfolio", id ?? "all");
    } catch {
      /* ignore */
    }
  };
  return <Ctx.Provider value={{ portfolioId, setPortfolioId }}>{children}</Ctx.Provider>;
}

export function useFilter(): FilterCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFilter must be used within FilterProvider");
  return ctx;
}
