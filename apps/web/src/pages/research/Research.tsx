import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
import { useFilter, useFundamentals, useHoldings, useSecurityDetail, useStockNews } from "@/lib/hooks";
import { StockLinks, stockHref } from "@/components/StockLinks";
import type { PriceRange } from "@/lib/api";
import { ago, assetClassLabel, compactMoney, dateShort, money, num, qty, signedMoney, signedPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Research: search one of your stocks, then see your position, its chart and the technicals. */
export function Research() {
  const { id } = useParams();
  return id ? <StockResearch id={id} /> : <ResearchSearch />;
}

// ---- Search landing ---------------------------------------------------------------------------

function ResearchSearch() {
  const { scope, active } = useFilter();
  const { data, isLoading } = useHoldings(scope);
  const view = useMoneyView();
  const [q, setQ] = useState("");
  const nav = useNavigate();

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
          <p className="mt-2 text-sm text-muted-foreground">Look up one of your stocks — your position, its chart and the technicals.</p>
        </div>
        <ScopeSelect currency />
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a stock you hold…" className="h-11 rounded-xl pl-10" autoFocus />
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
        ) : (
          <Empty title={q ? "No match" : "Nothing to research yet"} body={q ? "No held stock matches that." : "Once you hold some shares, look them up here."} />
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
    </div>
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
  const [range, setRange] = useState<Range>("1y");

  const series = useMemo(() => {
    const all = data?.history ?? [];
    const days = RANGES.find((r) => r.value === range)!.days;
    const since = days === null ? "" : new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    return all.filter((b) => b.date >= since).map((b) => ({ time: b.date, value: b.close }));
  }, [data, range]);

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

      {/* Price chart */}
      <Panel title="Price" action={<Segmented ariaLabel="Chart range" size="xs" options={RANGES.map(({ value, label }) => ({ value, label }))} value={range} onChange={setRange} />}>
        {series.length >= 2 ? (
          <>
            <StockChart points={series} markers={markers} currency={cur} height={320} />
            <p className="mt-3 text-xs text-muted-foreground">
              <span className="text-gain">▲</span> your buys · <span className="text-loss">▼</span> your sells
              {v?.converted && ` · prices here and below stay in ${cur}, as they traded`}
            </p>
          </>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">No public daily price history to chart for this one.</p>
        )}
      </Panel>

      {/* 52-week range */}
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

      {/* Technicals */}
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

      {s.assetClass === "equity" && <LatestNews id={id} />}

      {/* Fundamentals — from Yahoo (public ticker only) */}
      <FundamentalsPanel id={id} scope={scope} cur={cur} />
    </div>
  );
}

/** The newest few headlines about this stock, with the AI's one-line read; the rest on News. */
function LatestNews({ id }: { id: string }) {
  const { data } = useStockNews(id);
  if (!data?.live) return null;
  const items = data.items.slice(0, 4);
  return (
    <Panel
      title="Latest news"
      action={
        <Link to={stockHref.news(id)} className="text-xs font-medium text-primary hover:underline">
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
  const { data, isLoading } = useFundamentals(id, scope);
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
          <p className="mt-4 text-xs text-muted-foreground">From Yahoo Finance by public ticker only — nothing about your holding is sent. Figures can lag or be missing; nothing here is advice.</p>
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
