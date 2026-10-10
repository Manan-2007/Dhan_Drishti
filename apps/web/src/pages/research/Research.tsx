import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Lock, Search } from "lucide-react";
import { StockChart, type StockMarker } from "@/components/charts/StockChart";
import { Segmented } from "@/components/kit/Segmented";
import { Panel } from "@/components/kit/Panel";
import { Stat } from "@/components/kit/Stat";
import { Empty } from "@/components/kit/Empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CurrencySwitch, NoMatch, ScopeSelect } from "@/components/shell/ScopeSelect";
import { useMoneyView } from "@/lib/money-view";
import { useFilter, useFundamentals, useHoldings, useSecurityDetail, useStockNews, useTickerFundamentals, useTickerNews, useTickerResearch, useTickerSearch } from "@/lib/hooks";
import { StockLinks, stockHref } from "@/components/StockLinks";
import type { FundamentalsResponse, PriceRange, StockNewsResponse, Technicals, TickerHit } from "@/lib/api";
import { ago, assetClassLabel, compactMoney, dateShort, money, num, qty, signedMoney, signedPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Research: search one of your stocks, then see your position, its chart and the technicals. */
export function Research() {
  const { id, ticker } = useParams();
  if (ticker) return <TickerResearchView ticker={ticker.toUpperCase()} />;
  return id ? <StockResearch id={id} /> : <ResearchSearch />;
}

// ---- Search landing ---------------------------------------------------------------------------

function ResearchSearch() {
  const { scope, active } = useFilter();
  const { data, isLoading } = useHoldings(scope);
  const view = useMoneyView();
  const [q, setQ] = useState("");
  const nav = useNavigate();
  // Any listed stock too, once there's something to search for (public data; only the text is sent).
  const [dq, setDq] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const publicHits = useTickerSearch(dq);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.holdings ?? [])
      .filter((h) => Number(h.netQty) !== 0)
      .filter((h) => !needle || h.security.symbol.toLowerCase().includes(needle) || h.security.name.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.baseCurrentValue ?? 0) - Number(a.baseCurrentValue ?? 0));
  }, [data, q]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl leading-none tracking-tight sm:text-5xl">Research</h1>
          <p className="mt-2 text-sm text-muted-foreground">Look up any stock — yours with your position, or any other listed in India or the US.</p>
        </div>
        <ScopeSelect currency />
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any stock — e.g. Infosys, NVDA…" className="h-11 rounded-xl pl-10" autoFocus />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        !q && active ? (
          <NoMatch />
        ) : q ? (
          <p className="text-sm text-muted-foreground">None of your stocks match “{q.trim()}”.</p>
        ) : (
          <Empty title="Nothing to research yet" body="Once you hold some shares, they show up here — or search any stock above." />
        )
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((h) => (
            <button
              key={h.security.id}
              type="button"
              onClick={() => nav(`/research/${h.security.id}`)}
              className="group flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3.5 text-left transition-colors hover:border-primary/50 hover:bg-raised active:scale-[0.99]"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold group-hover:text-primary">{h.security.symbol}</p>
                <p className="truncate text-xs text-muted-foreground">{[h.security.name !== h.security.symbol ? h.security.name : null, assetClassLabel(h.security.assetClass)].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold tabular-nums">
                  {(() => {
                    const px = view.price(h.quote?.price, h.security.currency, h.fxRate);
                    return px.v === null ? "—" : money(px.v, px.cur);
                  })()}
                </p>
                {(() => {
                  const cv = num(h.currentValue);
                  const tc = num(h.todayChange);
                  const prev = cv !== null && tc !== null ? cv - tc : null;
                  const todayPct = prev && prev !== 0 && tc !== null ? tc / prev : null;
                  return todayPct !== null ? <p className={cn("text-xs tabular-nums", todayPct >= 0 ? "text-gain" : "text-loss")}>{signedPct(todayPct)}</p> : null;
                })()}
              </div>
            </button>
          ))}
        </div>
      )}

      {dq.length >= 2 && <PublicResults hits={publicHits.data?.results ?? []} loading={publicHits.isFetching && !publicHits.data} held={new Set(rows.map((h) => h.security.id))} live={publicHits.data?.live ?? true} />}
    </div>
  );
}

/** Stocks found by the public search, beyond the ones you hold. */
function PublicResults({ hits, loading, held, live }: { hits: TickerHit[]; loading: boolean; held: Set<string>; live: boolean }) {
  const shown = hits.filter((h) => !h.securityId || !held.has(h.securityId));
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Other stocks</h2>
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : !live ? (
        <p className="text-sm text-muted-foreground">Searching other stocks needs market data, which is off or unreachable right now.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No other listed stock matches that.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((h) => (
            <Link
              key={h.ticker}
              to={h.securityId ? `/research/${h.securityId}` : `/research/t/${encodeURIComponent(h.ticker)}`}
              className="group flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3.5 transition-colors hover:border-primary/50 hover:bg-raised"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold group-hover:text-primary">{h.ticker.replace(/\.(NS|BO)$/, "")}</p>
                <p className="truncate text-xs text-muted-foreground">{h.name}</p>
              </div>
              <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                {h.market === "in" ? "🇮🇳" : "🇺🇸"} {h.exchange}
                {h.type === "ETF" ? " · ETF" : ""}
                {h.securityId ? " · traded before" : ""}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// ---- Per-stock research view ------------------------------------------------------------------

type Range = "1m" | "3m" | "6m" | "1y" | "max";
const RANGES: { value: Range; label: string; days: number | null }[] = [
  { value: "1m", label: "1M", days: 31 },
  { value: "3m", label: "3M", days: 92 },
  { value: "6m", label: "6M", days: 183 },
  { value: "1y", label: "1Y", days: 366 },
  { value: "max", label: "All", days: null },
];

function StockResearch({ id }: { id: string }) {
  const { scope } = useFilter();
  const { data, isLoading, isError } = useSecurityDetail(id, scope);
  const view = useMoneyView();

  const markers = useMemo(() => {
    const seen = new Set<string>();
    const out: StockMarker[] = [];
    for (const t of data?.transactions ?? []) {
      if (t.type !== "buy" && t.type !== "sell") continue;
      const day = t.tradeDate.slice(0, 10);
      if (seen.has(`${day}|${t.type}`)) continue;
      seen.add(`${day}|${t.type}`);
      out.push({ time: day, kind: t.type });
    }
    return out;
  }, [data]);

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-16 w-72 rounded-xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }
  if (isError || !data) {
    return <Empty title="Not found" body="This isn't in your records." action={<Link to="/research" className="text-sm underline">Back to research</Link>} />;
  }

  const s = data.security;
  const p = data.position;
  const cur = s.currency;
  const t = data.technicals;
  const quote = p?.quote;
  const held = p && Number(p.netQty) !== 0;
  // Your money in the switch's currency; the market's own data (chart, ranges, technicals) stays in
  // the stock's — old prices converted at today's rate would tell a story that never happened.
  const v = p ? view.holding(p) : null;
  const px = view.price(quote?.price, cur, p?.fxRate);
  const yourReturn = v ? v.pnlPct : null;
  const stockYear = t.changePct.year;
  // technicals.changePct is already a percent (signedPct expects a ratio, so format it directly).
  const fmtPct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`);

  return (
    <div className="space-y-5">
      <Link to="/research" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Research
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl leading-none tracking-tight">{s.symbol}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {[s.name !== s.symbol ? s.name : null, assetClassLabel(s.assetClass), s.sector, s.exchange, cur !== "INR" ? cur : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <CurrencySwitch />
          {quote && (
            <div className="text-right">
              <p className="text-3xl font-semibold tabular-nums">{money(px.v, px.cur)}</p>
              <p className="text-xs text-muted-foreground">
                {px.cur !== cur && `${money(quote.price, cur)} · `}as of {dateShort(quote.asOf)}
              </p>
            </div>
          )}
        </div>
      </div>

      <StockLinks id={id} here="research" assetClass={s.assetClass} />

      {/* You & this stock */}
      <Panel title="You & this stock">
        {held ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="You hold" value={qty(p!.netQty)} sub={v!.avgCost !== null ? `at ${money(v!.avgCost, v!.cur)} avg` : undefined} />
            <Stat label="Worth now" value={v!.value !== null ? money(v!.value, v!.cur) : "—"} />
            <Stat
              label="Your return"
              value={yourReturn !== null ? signedPct(yourReturn) : "—"}
              tone={(yourReturn ?? 0) >= 0 ? "gain" : "loss"}
              sub={v!.pnl !== null ? `${signedMoney(v!.pnl, v!.cur)} on paper${v!.converted ? ", with the dollar's move" : ""}` : "on paper"}
            />
            <Stat label="The stock · 1Y" value={fmtPct(stockYear)} tone={(stockYear ?? 0) >= 0 ? "gain" : "loss"} sub="its own move" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">You don't hold this right now{p ? " — but you have traded it before" : ""}. The chart and technicals below are the market's, not yours.</p>
        )}
      </Panel>

      <MarketPanels history={data.history} t={t} cur={cur} markers={markers} note={v?.converted ? `prices here and below stay in ${cur}, as they traded` : null} />

      {s.assetClass === "equity" && <LatestNews id={id} />}

      {/* Fundamentals — from Yahoo (public ticker only) */}
      <FundamentalsPanel id={id} scope={scope} cur={cur} />
    </div>
  );
}

/** The market's own view of a stock: price chart, ranges and technicals — the same for any stock. */
function MarketPanels({ history, t, cur, markers, note }: { history: { date: string; close: number }[]; t: Technicals; cur: string; markers?: StockMarker[]; note?: string | null }) {
  const [range, setRange] = useState<Range>("1y");
  const series = useMemo(() => {
    const days = RANGES.find((r) => r.value === range)!.days;
    const since = days === null ? "" : new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    return history.filter((b) => b.date >= since).map((b) => ({ time: b.date, value: b.close }));
  }, [history, range]);
  return (
    <>
      <Panel title="Price" action={<Segmented ariaLabel="Chart range" size="xs" options={RANGES.map(({ value, label }) => ({ value, label }))} value={range} onChange={setRange} />}>
        {series.length >= 2 ? (
          <>
            <StockChart points={series} markers={markers} currency={cur} height={320} />
            {(markers?.length || note) && (
              <p className="mt-3 text-xs text-muted-foreground">
                {markers?.length ? (
                  <>
                    <span className="text-gain">▲</span> your buys · <span className="text-loss">▼</span> your sells
                  </>
                ) : null}
                {note && `${markers?.length ? " · " : ""}${note}`}
              </p>
            )}
          </>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">No public daily price history to chart for this one.</p>
        )}
      </Panel>

      {t.ranges.year && (
        <Panel title="Price ranges">
          <RangeBar range={t.ranges.year} last={t.last} position={t.rangePosition52w} currency={cur} label="52-week" />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SmallRange label="This week" r={t.ranges.week} cur={cur} />
            <SmallRange label="This month" r={t.ranges.month} cur={cur} />
            <SmallRange label="This quarter" r={t.ranges.quarter} cur={cur} />
            <SmallRange label="This year" r={t.ranges.year} cur={cur} />
          </div>
        </Panel>
      )}

      {t.bars > 1 ? (
        <Panel title="Technicals" action={<span className="text-xs text-muted-foreground">from {t.bars} days of real prices</span>}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
            <Rsi value={t.rsi14} />
            <TechRow label="Trend" value={t.trend === "above" ? "Above 200-DMA" : t.trend === "below" ? "Below 200-DMA" : "—"} tone={t.trend === "above" ? "gain" : t.trend === "below" ? "loss" : undefined} />
            <TechRow label="Support (S1)" value={t.support ? money(t.support, cur) : "—"} />
            <TechRow label="Resistance (R1)" value={t.resistance ? money(t.resistance, cur) : "—"} />
            <TechRow label="SMA 20" value={t.sma["20"] ? money(t.sma["20"], cur) : "—"} />
            <TechRow label="SMA 50" value={t.sma["50"] ? money(t.sma["50"], cur) : "—"} />
            <TechRow label="SMA 200" value={t.sma["200"] ? money(t.sma["200"], cur) : "—"} />
            <TechRow label="EMA 12 / 26" value={t.ema["12"] && t.ema["26"] ? `${money(t.ema["12"], cur)} / ${money(t.ema["26"], cur)}` : "—"} />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Indicators are informational, derived from past prices, and are not advice to buy or sell.</p>
        </Panel>
      ) : (
        <Panel title="Technicals">
          <p className="text-sm text-muted-foreground">Not enough price history yet to work out indicators.</p>
        </Panel>
      )}
    </>
  );
}

// ---- Any listed stock (not in your records) ---------------------------------------------------

/** Research for a stock you don't hold: the market's view from public data, with news and fundamentals. */
function TickerResearchView({ ticker }: { ticker: string }) {
  const { data, isLoading, isError } = useTickerResearch(ticker);
  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-16 w-72 rounded-xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }
  if (isError || !data) {
    return <Empty title="Couldn't find that stock" body={`No public prices for ${ticker} right now.`} action={<Link to="/research" className="text-sm underline">Back to research</Link>} />;
  }
  // You've traded it: your own view has your position as well.
  if (data.securityId) return <Navigate to={`/research/${data.securityId}`} replace />;

  const cur = data.currency;
  const q = data.quote;
  const change = q && q.prevClose ? q.price - q.prevClose : null;
  const symbol = ticker.replace(/\.(NS|BO)$/, "");
  const yearPct = data.technicals.changePct.year;
  return (
    <div className="space-y-5">
      <Link to="/research" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Research
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl leading-none tracking-tight">{symbol}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{[data.name, data.exchange, cur !== "INR" ? cur : null].filter(Boolean).join(" · ")}</p>
        </div>
        {q && (
          <div className="text-right">
            <p className="text-3xl font-semibold tabular-nums">{money(q.price, cur)}</p>
            <p className="text-xs text-muted-foreground">
              {change !== null && q.prevClose ? (
                <span className={cn("mr-1.5 font-semibold", change >= 0 ? "text-gain" : "text-loss")}>
                  {signedMoney(change, cur, false)} ({signedPct(change / q.prevClose)}) today ·
                </span>
              ) : null}
              {q.asOf ? `as of ${dateShort(q.asOf)}` : ""}
            </p>
          </div>
        )}
      </div>

      <Panel title="You & this stock">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">You don't hold this. Everything here is public market data — nothing about your portfolio was sent to look it up.</p>
          <Stat label="The stock · 1Y" value={yearPct === null ? "—" : `${yearPct > 0 ? "+" : yearPct < 0 ? "−" : ""}${Math.abs(yearPct).toFixed(2)}%`} tone={(yearPct ?? 0) >= 0 ? "gain" : "loss"} sub="its own move" />
        </div>
      </Panel>

      <MarketPanels history={data.history} t={data.technicals} cur={cur} />
      <TickerNews ticker={ticker} name={data.name} />
      <TickerFundamentals ticker={ticker} cur={cur} />
    </div>
  );
}

function TickerFundamentals({ ticker, cur }: { ticker: string; cur: string }) {
  return <FundamentalsView query={useTickerFundamentals(ticker)} cur={cur} />;
}

function TickerNews({ ticker, name }: { ticker: string; name: string }) {
  const { data } = useTickerNews(ticker, name);
  return <NewsPanel data={data} href={`/news?ticker=${encodeURIComponent(ticker)}&name=${encodeURIComponent(name)}`} />;
}

/** The newest few headlines about this stock, with the AI's one-line read; the rest on News. */
function LatestNews({ id }: { id: string }) {
  const { data } = useStockNews(id);
  return <NewsPanel data={data} href={stockHref.news(id)} />;
}

function NewsPanel({ data, href }: { data: StockNewsResponse | undefined; href: string }) {
  if (!data?.live) return null;
  const items = data.items.slice(0, 4);
  return (
    <Panel
      title="Latest news"
      action={
        <Link to={href} className="text-xs font-medium text-primary hover:underline">
          All news on {data.symbol} →
        </Link>
      }
    >
      {data.read && <p className="mb-3 max-w-3xl text-sm leading-relaxed">{data.read.summary}</p>}
      {!data.loaded ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No news about {data.name} this week.</p>
      ) : (
        <ul className="divide-y">
          {items.map((h) => (
            <li key={h.id}>
              <a href={h.link} target="_blank" rel="noreferrer noopener" className="group block py-2">
                <span className="block text-sm leading-snug group-hover:text-primary">{h.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{[h.source, `published ${ago(h.publishedAt)}`].filter(Boolean).join(" · ")}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FundamentalsPanel({ id, scope, cur }: { id: string; scope: string; cur: string }) {
  return <FundamentalsView query={useFundamentals(id, scope)} cur={cur} />;
}

function FundamentalsView({ query, cur }: { query: { data: FundamentalsResponse | undefined; isLoading: boolean }; cur: string }) {
  const { data, isLoading } = query;
  const f = data?.available ? data.fundamentals : null;
  const ratio = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));
  const perc = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
  const rec = f?.recommendationKey ? f.recommendationKey.replace(/_/g, " ") : null;

  return (
    <Panel title="Fundamentals" action={data?.ticker ? <span className="text-xs text-muted-foreground">Yahoo · {data.ticker}</span> : undefined}>
      {isLoading ? (
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      ) : f ? (
        <>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
            <TechRow label="Market cap" value={f.marketCap != null ? compactMoney(String(f.marketCap), cur) : "—"} />
            <TechRow label="PE (TTM)" value={ratio(f.trailingPE)} />
            <TechRow label="Forward PE" value={ratio(f.forwardPE)} />
            <TechRow label="PEG" value={ratio(f.pegRatio)} />
            <TechRow label="Price / book" value={ratio(f.priceToBook)} />
            <TechRow label="EPS (TTM)" value={f.eps != null ? money(f.eps, cur) : "—"} />
            <TechRow label="Dividend yield" value={perc(f.dividendYield)} />
            <TechRow label="Profit margin" value={perc(f.profitMargin)} />
            <TechRow label="Operating margin" value={perc(f.operatingMargin)} />
            <TechRow label="Revenue growth (YoY)" value={perc(f.revenueGrowth)} tone={f.revenueGrowth != null ? (f.revenueGrowth >= 0 ? "gain" : "loss") : undefined} />
            <TechRow label="Earnings growth (YoY)" value={perc(f.earningsGrowth)} tone={f.earningsGrowth != null ? (f.earningsGrowth >= 0 ? "gain" : "loss") : undefined} />
            <TechRow label="Return on equity" value={perc(f.returnOnEquity)} />
          </div>
          {(f.targetMeanPrice != null || rec) && (
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-4 text-sm">
              {f.targetMeanPrice != null && (
                <span className="text-muted-foreground">
                  Analyst target <span className="font-semibold text-foreground tabular-nums">{money(f.targetMeanPrice, cur)}</span>
                  {f.numberOfAnalysts ? ` · ${f.numberOfAnalysts} analyst${f.numberOfAnalysts === 1 ? "" : "s"}` : ""}
                </span>
              )}
              {rec && <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize">{rec}</span>}
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">From Yahoo Finance by public ticker only — nothing about your portfolio is sent. Figures can lag or be missing; nothing here is advice.</p>
        </>
      ) : (
        <div className="flex items-start gap-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <p>
            {data?.reason === "no_fundamentals"
              ? "Fundamentals aren't published for this kind of holding (mutual funds, cash and crypto have none)."
              : data?.reason === "disabled"
                ? "Fundamentals are off on this server."
                : "Couldn't fetch fundamentals right now — the provider may be rate-limiting. It'll try again later. Everything else on this page is derived locally and is exact."}
          </p>
        </div>
      )}
    </Panel>
  );
}

function RangeBar({ range, last, position, currency, label }: { range: PriceRange; last: string | null; position: number | null; currency: string; label: string }) {
  const pct = position !== null ? Math.max(0, Math.min(1, position)) * 100 : null;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <span>{label} low · {money(range.low, currency)}</span>
        <span>high · {money(range.high, currency)}</span>
      </div>
      <div className="relative h-2 rounded-full bg-raised">
        {pct !== null && (
          <div className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary" style={{ left: `${pct}%` }} title={last ? money(last, currency) : undefined} />
        )}
      </div>
      {last && pct !== null && <p className="mt-1.5 text-center text-xs text-muted-foreground">now {money(last, currency)} · {Math.round(pct)}% of the band</p>}
    </div>
  );
}

function SmallRange({ label, r, cur }: { label: string; r: PriceRange | null; cur: string }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums">{r ? `${money(r.low, cur)} – ${money(r.high, cur)}` : "—"}</p>
    </div>
  );
}

function TechRow({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 font-semibold tabular-nums", tone === "gain" && "text-gain", tone === "loss" && "text-loss")}>{value}</p>
    </div>
  );
}

function Rsi({ value }: { value: number | null }) {
  if (value === null) return <TechRow label="RSI (14)" value="—" />;
  const tone = value >= 70 ? "loss" : value <= 30 ? "gain" : undefined; // overbought red, oversold green
  const tag = value >= 70 ? "overbought" : value <= 30 ? "oversold" : "neutral";
  return (
    <div>
      <p className="text-xs text-muted-foreground">RSI (14)</p>
      <p className={cn("mt-0.5 font-semibold tabular-nums", tone === "gain" && "text-gain", tone === "loss" && "text-loss")}>
        {value.toFixed(0)} <span className="text-xs font-normal text-muted-foreground">· {tag}</span>
      </p>
    </div>
  );
}
