import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api, type ActivityPage, type Portfolio, type Account, type HoldingsResponse, type Transaction, type ImportBatch, type NetWorthSeries, type RebalanceResponse, type RebalanceDimension, type ManualAssetsResult, type CapitalGainsReport, type SecurityDetail, type IndicesResponse, type NewsResponse, type StockNewsResponse, type AttentionResponse, type TickerSearchResponse, type TickerResearch, type NewsMarket, type FundamentalsResponse } from "./api.js";

/**
 * Every data hook takes `scope`: the query string for the people / brokers / market chosen in the
 * filter bar ("" = everything). See useFilter() below and server/domain/scope.ts.
 */
export function withScope(path: string, scope: string, extra: Record<string, string | null | undefined> = {}): string {
  const p = new URLSearchParams(scope);
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== "") p.set(k, v);
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}

/** The scope for one person — e.g. a card on the People page. */
export const personScope = (portfolioId: string) => `portfolioIds=${encodeURIComponent(portfolioId)}`;

export function useCapitalGains(scope: string) {
  return useQuery({
    queryKey: ["capital-gains", scope],
    queryFn: () => api.get<CapitalGainsReport>(withScope("/api/reports/capital-gains", scope)),
  });
}

export function useSecurityDetail(id: string | undefined, scope: string) {
  return useQuery({
    enabled: !!id,
    queryKey: ["security-detail", id, scope],
    queryFn: () => api.get<SecurityDetail>(withScope(`/api/securities/${id}/detail`, scope)),
  });
}

/** Company fundamentals — fetched separately so the detail page loads before Yahoo answers. */
export function useFundamentals(id: string | undefined, scope: string) {
  return useQuery({
    enabled: !!id,
    queryKey: ["fundamentals", id, scope],
    queryFn: () => api.get<FundamentalsResponse>(withScope(`/api/securities/${id}/fundamentals`, scope)),
    staleTime: 60 * 60 * 1000,
    retry: false,
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

/** News about what you hold. Polls quickly while the server is still fetching, then every 15 s.
 *  `market` picks the India or US side; omit it and the server shows your larger market. */
export function useNews(scope: string, market?: NewsMarket) {
  return useQuery({
    queryKey: ["news", scope, market ?? null],
    queryFn: () => api.get<NewsResponse>(withScope("/api/news", scope, { market })),
    refetchInterval: (query) => (query.state.data?.refreshing ? 3000 : 15000),
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
  });
}

/** Any listed share or ETF by name or symbol (public data; only the typed text is sent). */
export function useTickerSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ["ticker-search", term.toLowerCase()],
    queryFn: () => api.get<TickerSearchResponse>(`/api/search?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}

/** Research for a stock you don't hold: price, history and technicals from public data. */
export function useTickerResearch(ticker: string) {
  return useQuery({ queryKey: ["ticker-research", ticker], queryFn: () => api.get<TickerResearch>(`/api/research/ticker/${encodeURIComponent(ticker)}`), retry: false });
}

export function useTickerFundamentals(ticker: string) {
  return useQuery({ queryKey: ["ticker-fundamentals", ticker], queryFn: () => api.get<FundamentalsResponse>(`/api/research/ticker/${encodeURIComponent(ticker)}/fundamentals`) });
}

/** News on any listed stock by ticker; polls quickly while it's being fetched or read. */
export function useTickerNews(ticker: string | null, name?: string) {
  return useQuery({
    queryKey: ["news", "ticker", ticker],
    queryFn: () => api.get<StockNewsResponse>(`/api/news/ticker/${encodeURIComponent(ticker!)}${name ? `?name=${encodeURIComponent(name)}` : ""}`),
    enabled: !!ticker,
    refetchInterval: (query) => (query.state.data && (query.state.data.refreshing || !query.state.data.loaded) ? 3000 : 60_000),
    refetchIntervalInBackground: false,
  });
}

/** Everything missing or uncertain in the data, for the chosen people and brokers. */
export function useAttention(scope: string) {
  return useQuery({
    queryKey: ["attention", scope],
    queryFn: () => api.get<AttentionResponse>(withScope("/api/attention", scope)),
  });
}

/** One stock's headlines and AI read; polls quickly while they're being fetched or read. */
export function useStockNews(id: string | null) {
  return useQuery({
    queryKey: ["news", "stock", id],
    queryFn: () => api.get<StockNewsResponse>(`/api/news/security/${encodeURIComponent(id!)}`),
    enabled: !!id,
    refetchInterval: (query) => (query.state.data && (query.state.data.refreshing || !query.state.data.loaded) ? 3000 : 60_000),
    refetchIntervalInBackground: false,
  });
}

export function useManualAssets(scope: string) {
  return useQuery({
    queryKey: ["manual-assets", scope],
    queryFn: () => api.get<ManualAssetsResult>(withScope("/api/manual-assets", scope)),
  });
}

export function useRebalance(scope: string, dimension: RebalanceDimension) {
  return useQuery({
    queryKey: ["rebalance", scope, dimension],
    queryFn: () => api.get<RebalanceResponse>(withScope("/api/rebalance", scope, { dimension })),
  });
}

export type NetWorthRange = "1m" | "3m" | "6m" | "1y" | "max";
export function useNetWorth(scope: string, range: NetWorthRange) {
  return useQuery({
    queryKey: ["networth", scope, range],
    queryFn: () => api.get<NetWorthSeries>(withScope("/api/performance/networth", scope, { range })),
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

export function useHoldings(scope: string) {
  return useQuery({
    queryKey: ["holdings", scope],
    queryFn: () => api.get<HoldingsResponse>(withScope("/api/holdings", scope)),
  });
}

export interface ActivityFilter {
  scope: string;
  accountId?: string;
  /** Just one stock's entries. */
  securityId?: string;
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
      const search = new URLSearchParams(filter.scope);
      search.set("limit", String(pageSize));
      search.set("offset", String(pageParam));
      if (filter.accountId) search.set("accountId", filter.accountId);
      if (filter.securityId) search.set("securityId", filter.securityId);
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

export function useTransactions(params: { scope: string; type?: string; limit?: number }) {
  const search = new URLSearchParams(params.scope);
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

export function usePerformance(scope: string) {
  return useQuery({
    queryKey: ["performance", scope],
    queryFn: () => api.get<PerformanceSummary>(withScope("/api/performance/summary", scope)),
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
export function useValueHistory(scope: string, range: string) {
  return useQuery({
    queryKey: ["value-history", scope, range],
    queryFn: () => api.get<ValueHistory>(withScope("/api/performance/value-history", scope, { range })),
    placeholderData: (prev) => prev,
    refetchInterval: (q) => ((q.state.data?.pending ?? 0) > 0 ? 4000 : false),
  });
}

export function useTwr(scope: string, enabled: boolean) {
  return useQuery({
    enabled,
    staleTime: 60_000,
    queryKey: ["twr", scope],
    queryFn: () => api.get<TwrResponse>(withScope("/api/performance/twr", scope)),
  });
}

export function useBenchmarks() {
  return useQuery({
    queryKey: ["benchmarks"],
    queryFn: () =>
      api.get<{ benchmarks: { id: string; label: string }[] }>("/api/performance/benchmarks").then((r) => r.benchmarks),
  });
}

export function useBenchmark(scope: string, benchmarkId: string | null) {
  return useQuery({
    enabled: !!benchmarkId,
    queryKey: ["benchmark", scope, benchmarkId],
    queryFn: () => api.get<BenchmarkComparison>(withScope("/api/performance/benchmark", scope, { benchmark: benchmarkId })),
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

export function useDividends(scope: string) {
  return useQuery({
    queryKey: ["dividends", scope],
    queryFn: () => api.get<DividendsResponse>(withScope("/api/dividends", scope)),
  });
}

export function useImports() {
  return useQuery({
    queryKey: ["imports"],
    queryFn: () => api.get<{ imports: ImportBatch[] }>("/api/imports").then((r) => r.imports),
  });
}

// ---- The filter: whose money, at which brokers, in which market (remembered per login) ----

export type MarketFilter = "in" | "us" | null;
export interface Filter {
  people: string[]; // portfolio ids; empty = everyone
  brokers: string[]; // broker ids (zerodha, vested, …); empty = all brokers
  market: MarketFilter; // null = both
}
interface FilterCtx extends Filter {
  /** Query string for the API ("" = everything). Pass it to the data hooks. */
  scope: string;
  /** The one person, when exactly one is chosen — who new things (an FD, a target) belong to. */
  portfolioId: string | null;
  /** Anything narrowed at all? */
  active: boolean;
  setPortfolioId: (id: string | null) => void;
  setPeople: (ids: string[]) => void;
  setBrokers: (ids: string[]) => void;
  setMarket: (m: MarketFilter) => void;
  clear: () => void;
  /** Show US (any foreign-currency) figures in the base currency instead of their own. Not part of the filter. */
  usInBase: boolean;
  setUsInBase: (on: boolean) => void;
}
const Ctx = createContext<FilterCtx | null>(null);

const EMPTY: Filter = { people: [], brokers: [], market: null };
const filterKey = (userId: string | undefined) => `dd-filter:${userId ?? "anon"}`;
const legacyKey = (userId: string | undefined) => `dd-portfolio:${userId ?? "anon"}`;
const usInBaseKey = (userId: string | undefined) => `dd-us-in-base:${userId ?? "anon"}`;

export function scopeOf(f: Filter): string {
  const p = new URLSearchParams();
  if (f.people.length) p.set("portfolioIds", [...f.people].sort().join(","));
  if (f.brokers.length) p.set("brokers", [...f.brokers].sort().join(","));
  if (f.market) p.set("market", f.market);
  return p.toString();
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const key = filterKey(user?.id);
  const read = (): Filter => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const f = JSON.parse(raw) as Partial<Filter>;
        return { people: f.people ?? [], brokers: f.brokers ?? [], market: f.market === "in" || f.market === "us" ? f.market : null };
      }
      // The older single-person choice carries over.
      const legacy = localStorage.getItem(legacyKey(user?.id));
      if (legacy && legacy !== "all") return { ...EMPTY, people: [legacy] };
    } catch {
      /* fall through */
    }
    return EMPTY;
  };
  const [state, setState] = useState<{ key: string; f: Filter }>(() => ({ key, f: read() }));
  // A different login in the same browser starts from its own choice, never the last one's.
  const f = state.key === key ? state.f : read();
  const save = (next: Filter) => {
    setState({ key, f: next });
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const readUsInBase = () => {
    try {
      return localStorage.getItem(usInBaseKey(user?.id)) === "1";
    } catch {
      return false;
    }
  };
  const [inBase, setInBase] = useState<{ key: string; on: boolean }>(() => ({ key, on: readUsInBase() }));
  const usInBase = inBase.key === key ? inBase.on : readUsInBase();
  const setUsInBase = (on: boolean) => {
    setInBase({ key, on });
    try {
      localStorage.setItem(usInBaseKey(user?.id), on ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  // A remembered person or broker that isn't this login's any more (deleted, or left over) would make
  // every screen ask for data it can't see — and look empty. Drop it.
  const { data: portfolios } = usePortfolios();
  const { data: accounts } = useAllAccounts();
  useEffect(() => {
    if (!portfolios || !accounts) return;
    const people = f.people.filter((id) => portfolios.some((p) => p.id === id));
    const brokers = f.brokers.filter((b) => accounts.some((a) => a.broker === b));
    if (people.length !== f.people.length || brokers.length !== f.brokers.length) save({ ...f, people, brokers });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolios, accounts, f.people.join(","), f.brokers.join(",")]);

  const value: FilterCtx = {
    ...f,
    scope: scopeOf(f),
    portfolioId: f.people.length === 1 ? f.people[0]! : null,
    active: f.people.length > 0 || f.brokers.length > 0 || f.market !== null,
    setPortfolioId: (id) => save({ ...f, people: id ? [id] : [] }),
    setPeople: (people) => save({ ...f, people }),
    setBrokers: (brokers) => save({ ...f, brokers }),
    setMarket: (market) => save({ ...f, market }),
    clear: () => save(EMPTY),
    usInBase,
    setUsInBase,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFilter(): FilterCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFilter must be used within FilterProvider");
  return ctx;
}
