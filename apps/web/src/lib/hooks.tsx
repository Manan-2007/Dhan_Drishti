import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api, type ActivityPage, type Portfolio, type Account, type HoldingsResponse, type Transaction, type ImportBatch, type NetWorthSeries, type RebalanceResponse, type RebalanceDimension, type ManualAssetsResult, type CapitalGainsReport, type SecurityDetail, type IndicesResponse, type NewsResponse } from "./api.js";

export function useCapitalGains(portfolioId: string | null) {
  const qs = portfolioId ? `?portfolioId=${portfolioId}` : "";
  return useQuery({
    queryKey: ["capital-gains", portfolioId],
    queryFn: () => api.get<CapitalGainsReport>(`/api/reports/capital-gains${qs}`),
  });
}

export function useSecurityDetail(id: string | undefined, portfolioId: string | null) {
  const search = new URLSearchParams();
  if (portfolioId) search.set("portfolioId", portfolioId);
  const qs = search.toString();
  return useQuery({
    enabled: !!id,
    queryKey: ["security-detail", id, portfolioId],
    queryFn: () => api.get<SecurityDetail>(`/api/securities/${id}/detail${qs ? `?${qs}` : ""}`),
  });
}

/** Nifty 50, Bank Nifty, Sensex — polled every few seconds. */
export function useIndices() {
  return useQuery({
    queryKey: ["indices"],
    queryFn: () => api.get<IndicesResponse>("/api/market/indices"),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
  });
}

/** News about what you hold. Polls quickly while the server is still fetching, then every 15 s. */
export function useNews(portfolioId: string | null) {
  const qs = portfolioId ? `?portfolioId=${portfolioId}` : "";
  return useQuery({
    queryKey: ["news", portfolioId],
    queryFn: () => api.get<NewsResponse>(`/api/news${qs}`),
    refetchInterval: (q) => (q.state.data?.refreshing ? 3000 : 15000),
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
  });
}

export function useManualAssets(portfolioId: string | null) {
  const qs = portfolioId ? `?portfolioId=${portfolioId}` : "";
  return useQuery({
    queryKey: ["manual-assets", portfolioId],
    queryFn: () => api.get<ManualAssetsResult>(`/api/manual-assets${qs}`),
  });
}

export function useRebalance(portfolioId: string | null, dimension: RebalanceDimension) {
  const search = new URLSearchParams({ dimension });
  if (portfolioId) search.set("portfolioId", portfolioId);
  return useQuery({
    queryKey: ["rebalance", portfolioId, dimension],
    queryFn: () => api.get<RebalanceResponse>(`/api/rebalance?${search.toString()}`),
  });
}

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

/** Every account the user has, across all portfolios. */
export function useAllAccounts() {
  return useQuery({
    queryKey: ["accounts", "all"],
    queryFn: () => api.get<{ accounts: Account[] }>("/api/accounts").then((r) => r.accounts),
  });
}

export function useHoldings(portfolioId: string | null) {
  const qs = portfolioId ? `?portfolioId=${portfolioId}` : "";
  return useQuery({
    queryKey: ["holdings", portfolioId],
    queryFn: () => api.get<HoldingsResponse>(`/api/holdings${qs}`),
  });
}

export interface ActivityFilter {
  portfolioId: string | null;
  accountId?: string;
  types?: string[];
  q?: string;
  from?: string;
  to?: string;
}

/** The Activity timeline: newest first, a page at a time, with totals for the whole filter. */
export function useActivity(filter: ActivityFilter, pageSize = 150) {
  return useInfiniteQuery({
    queryKey: ["transactions", "activity", filter, pageSize],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ limit: String(pageSize), offset: String(pageParam) });
      if (filter.portfolioId) search.set("portfolioId", filter.portfolioId);
      if (filter.accountId) search.set("accountId", filter.accountId);
      if (filter.types?.length) search.set("types", filter.types.join(","));
      if (filter.q) search.set("q", filter.q);
      if (filter.from) search.set("from", filter.from);
      if (filter.to) search.set("to", filter.to);
      if (pageParam === 0) search.set("summary", "1");
      return api.get<ActivityPage>(`/api/transactions?${search.toString()}`);
    },
    getNextPageParam: (last) => (last.offset + last.transactions.length < last.total ? last.offset + last.transactions.length : undefined),
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
  mode?: "holdings" | "cash-inclusive" | "mixed";
  reason?: string;
  from?: string;
  asOf?: string;
  twr?: number | null;
  annualized?: number | null;
  subPeriods?: number;
  missingHistory?: string[];
}

export interface ValueHistory {
  available: boolean;
  reason?: string;
  baseCurrency: string;
  from?: string;
  to?: string;
  pending?: number;
  atCostShare?: number;
  points?: { date: string; value: number; invested: number }[];
}

/** Investments' value per trading day. Polls while price history is still being fetched. */
export function useValueHistory(portfolioId: string | null, range: string) {
  const search = new URLSearchParams({ range });
  if (portfolioId) search.set("portfolioId", portfolioId);
  return useQuery({
    queryKey: ["value-history", portfolioId, range],
    queryFn: () => api.get<ValueHistory>(`/api/performance/value-history?${search.toString()}`),
    placeholderData: (prev) => prev,
    refetchInterval: (q) => ((q.state.data?.pending ?? 0) > 0 ? 4000 : false),
  });
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

export type DividendCadence = "monthly" | "quarterly" | "half-yearly" | "annual" | "irregular" | "one-off";
export interface DividendUpcoming {
  security: { id: string; symbol: string; name: string };
  cadence: DividendCadence;
  paymentsObserved: number;
  lastDate: string;
  lastAmount: string | null;
  ttm: string;
  currentValue: string | null;
  trailingYield: string | null;
  estimatedNext: string | null;
}
export interface DividendsResponse {
  baseCurrency: string;
  fxComplete: boolean;
  unconvertibleCurrencies: string[];
  total: string;
  count: number;
  byFY: { key: string; amount: string }[];
  bySecurity: { symbol: string; name: string; amount: string }[];
  income: {
    ttm: string;
    ttmHeld: string;
    portfolioValue: string | null;
    trailingYield: string | null;
    asOf: string;
    windowFrom: string;
  };
  upcoming: DividendUpcoming[];
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

export function useImports() {
  return useQuery({
    queryKey: ["imports"],
    queryFn: () => api.get<{ imports: ImportBatch[] }>("/api/imports").then((r) => r.imports),
  });
}

// ---- Selected-portfolio filter (remembered per login, in this browser) ----
interface FilterCtx {
  portfolioId: string | null; // null = All portfolios
  setPortfolioId: (id: string | null) => void;
}
const Ctx = createContext<FilterCtx | null>(null);

const filterKey = (userId: string | undefined) => `dd-portfolio:${userId ?? "anon"}`;

export function FilterProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const key = filterKey(user?.id);
  const read = (): string | null => {
    try {
      const v = localStorage.getItem(key);
      return v && v !== "all" ? v : null;
    } catch {
      return null;
    }
  };
  const [state, setState] = useState<{ key: string; id: string | null }>(() => ({ key, id: read() }));
  // A different login in the same browser starts from its own choice, never the last one's.
  const portfolioId = state.key === key ? state.id : read();
  const setPortfolioId = (id: string | null) => {
    setState({ key, id });
    try {
      localStorage.setItem(key, id ?? "all");
    } catch {
      /* ignore */
    }
  };

  // A remembered person who isn't one of this login's (deleted, or left over from before) would
  // make every screen ask for data it may not see — and look empty. Fall back to everyone.
  const { data: portfolios } = usePortfolios();
  useEffect(() => {
    if (portfolioId && portfolios && !portfolios.some((p) => p.id === portfolioId)) setPortfolioId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioId, portfolios]);

  return <Ctx.Provider value={{ portfolioId, setPortfolioId }}>{children}</Ctx.Provider>;
}

export function useFilter(): FilterCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFilter must be used within FilterProvider");
  return ctx;
}
