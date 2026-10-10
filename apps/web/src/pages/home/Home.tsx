import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock, Loader2, FileWarning, PieChart, RefreshCw, Upload } from "lucide-react";
import { IndexTicker } from "@/components/market/IndexTicker";
import CountUp from "@/components/reactbits/CountUp";
import { StockChart } from "@/components/charts/StockChart";
import { Segmented } from "@/components/kit/Segmented";
import { NoMatch, ScopeSelect } from "@/components/shell/ScopeSelect";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAttention as useDataAttention, useFilter, useHoldings, usePortfolios, useValueHistory } from "@/lib/hooks";
import { Onboarding } from "@/components/Onboarding";
import { assetColor } from "@/lib/assetColors";
import { assetClassLabel, compactMoney, money, num, signedMoney, signedPct } from "@/lib/format";
import type { HoldingRow, HoldingsResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/kit/Panel";
import { displayName } from "@/lib/instrument";
import { sectorLabel } from "@dhan-drishti/core/sectors";

type Range = "1m" | "3m" | "6m" | "1y" | "max";
const RANGES: { value: Range; label: string }[] = [
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "1y", label: "1Y" },
  { value: "max", label: "All" },
];

/** A holding's day change converted to the base currency (via its own value's FX factor). */
function baseDayChange(h: HoldingRow): number | null {
  const change = num(h.todayChange);
  if (change === null) return null;
  const local = num(h.currentValue);
  const base = num(h.baseCurrentValue);
  if (local === null || base === null || local === 0) return change;
  return change * (base / local);
}

interface Attention {
  id: string;
  icon: ReactNode;
  text: string;
  action: ReactNode;
}

/** Home's own reminders: deposits maturing and concentration. Data gaps come from the server (useDataAttention). */
function useAttention(data: HoldingsResponse | undefined): Attention[] {
  const navigate = useNavigate();
  if (!data) return [];
  const items: Attention[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const m of (data.manualAssets ?? []).filter((a) => a.deposit?.maturityDate && (a.deposit.daysToMaturity ?? 99) <= 30)) {
    const dep = m.deposit!;
    items.push({
      id: `mature-${m.id}`,
      icon: <CalendarClock />,
      text: dep.matured
        ? `${m.name} matured on ${dep.maturityDate === today ? "today" : dep.maturityDate}. Renew it or move the money, then update it here.`
        : `${m.name} matures in ${dep.daysToMaturity} day${dep.daysToMaturity === 1 ? "" : "s"}${dep.maturityValue ? ` — about ${compactMoney(dep.maturityValue, data.baseCurrency)}` : ""}.`,
      action: <Button size="xs" variant="ghost" onClick={() => navigate("/portfolio/other")}>View</Button>,
    });
  }
  for (const f of data.diversification?.flags ?? []) {
    if (f.severity === "info") continue;
    items.push({
      id: `div-${f.message}`,
      icon: <PieChart />,
      text: f.message,
      action: <Button size="xs" variant="ghost" onClick={() => navigate("/portfolio/allocation")}>Allocation</Button>,
    });
  }
  return items;
}

export function Home() {
  const { portfolioId, scope, active } = useFilter();
  const { data, isLoading, isError, refetch } = useHoldings(scope);
  const [range, setRange] = useState<Range>("1y");
  const history = useValueHistory(scope, range);
  const reminders = useAttention(data);
  const gaps = useDataAttention(scope);
  // Data gaps first (each opens its spot on the Needs attention page), then Home's own reminders.
  const gapItems = (gaps.data?.items ?? []).filter((i) => i.severity !== "done");
  const attention: Attention[] = [
    ...gapItems.slice(0, 4).map((i) => ({
      id: i.id,
      icon: i.severity === "high" ? <AlertTriangle /> : <FileWarning />,
      text: i.title,
      action: (
        <Button size="xs" variant="ghost" asChild>
          <Link to={`/accounts/attention#${encodeURIComponent(i.id)}`}>Details</Link>
        </Button>
      ),
    })),
    ...reminders,
  ];
  const moreGaps = Math.max(0, gapItems.length - 4);
  const reduceMotion = useReducedMotion();

  const open = useMemo(() => (data?.holdings ?? []).filter((h) => Number(h.netQty) !== 0), [data]);
  const day = useMemo(() => {
    let change = 0;
    let any = false;
    for (const h of open) {
      const c = baseDayChange(h);
      if (c !== null) {
        change += c;
        any = true;
      }
    }
    const value = num(data?.summary.currentValue) ?? 0;
    const prior = value - change;
    return any ? { change, pct: prior > 0 ? change / prior : null } : null;
  }, [open, data]);

  const movers = useMemo(
    () =>
      open
        .map((h) => ({ h, change: baseDayChange(h) }))
        .filter((m): m is { h: HoldingRow; change: number } => m.change !== null && m.change !== 0)
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
        .slice(0, 5),
    [open],
  );

  const series = useMemo(() => {
    const pts = history.data?.points ?? [];
    return { value: pts.map((p) => ({ time: p.date, value: p.value })), invested: pts.map((p) => ({ time: p.date, value: p.invested })) };
  }, [history.data]);
  const pending = history.data?.pending ?? 0;
  const allocation = (data?.allocation.byAssetClass ?? []).filter((s) => Number(s.weight) > 0);

  if (isLoading) {
    return (
      <div className="grid gap-5 lg:grid-cols-12">
        <Skeleton className="h-[440px] rounded-2xl lg:col-span-8" />
        <Skeleton className="h-[440px] rounded-2xl lg:col-span-4" />
      </div>
    );
  }

  // A failed load is not "no data yet": say so, rather than inviting a fresh import.
  if (isError && !data) {
    return (
      <section className="mx-auto max-w-xl rounded-2xl border bg-card p-8 text-center">
        <p className="font-display text-4xl">Couldn't load your numbers.</p>
        <p className="mt-3 text-sm text-muted-foreground">Your data is safe. Check the server is running, then try again.</p>
        <Button className="mt-6" onClick={() => void refetch()}>
          <RefreshCw /> Try again
        </Button>
      </section>
    );
  }

  const nothingYet = !data || (data.holdings.length === 0 && (data.manualAssets?.length ?? 0) === 0);
  if (nothingYet) return active ? <NoMatch /> : <Welcome />;

  const s = data.summary;
  const netWorth = num(s.netWorth) ?? 0;
  const up = (day?.change ?? 0) >= 0;

  return (
    <div className="space-y-5">
      <IndexTicker />
      <div className="grid gap-5 lg:grid-cols-12">
        {/* Hero: where you stand today */}
        <section className="rounded-2xl border bg-card p-6 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Net worth</p>
            <ScopeSelect />
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-2">
            <p className="font-display text-6xl leading-none tracking-tight sm:text-7xl" title={money(netWorth, data.baseCurrency)}>
              <CountUp to={netWorth} format={(n) => compactMoney(n, data.baseCurrency)} />
            </p>
            {day && (
              <motion.p
                initial={reduceMotion ? false : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35, duration: 0.3 }}
                className={cn("mb-1.5 inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold", up ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss")}
              >
                {up ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                {signedMoney(day.change, data.baseCurrency)}
                {day.pct !== null && <span className="font-medium opacity-80">({signedPct(day.pct)})</span>}
                <span className="font-medium opacity-80">today</span>
              </motion.p>
            )}
          </div>
          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Investments</dt>
              <dd className="font-semibold">{compactMoney(s.currentValue, data.baseCurrency)}</dd>
            </div>
            {num(s.manualAssets) ? (
              <div>
                <dt className="text-muted-foreground">Other assets</dt>
                <dd className="font-semibold">{compactMoney(s.manualAssets, data.baseCurrency)}</dd>
              </div>
            ) : null}
            {data.cashTracked && (
              <div>
                <dt className="text-muted-foreground">Cash</dt>
                <dd className="font-semibold">{compactMoney(s.cash, data.baseCurrency)}</dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">Unrealised P&amp;L</dt>
              <dd className={cn("font-semibold", Number(s.unrealisedPnl) >= 0 ? "text-gain" : "text-loss")}>{signedMoney(s.unrealisedPnl, data.baseCurrency)}</dd>
            </div>
          </dl>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {pending > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" /> Fetching price history · {pending} to go
                </span>
              ) : (
                "Shares, ETFs and funds · F&O left out · dashed line is what you put in"
              )}
            </p>
            <Segmented ariaLabel="Chart range" size="xs" options={RANGES} value={range} onChange={setRange} />
          </div>
          <div className="mt-3">
            {history.isLoading ? (
              <Skeleton className="h-[300px] rounded-xl" />
            ) : series.value.length >= 2 ? (
              <StockChart points={series.value} compare={series.invested} compareLabel="Put in" measure="compare" label="Your investments" currency={data.baseCurrency} format={(n) => compactMoney(n, data.baseCurrency)} height={260} />
            ) : (
              <div className="grid h-[260px] place-items-center rounded-xl border border-dashed text-center text-sm text-muted-foreground">
                <p className="max-w-xs">The chart draws once your trades are in and their price history arrives.</p>
              </div>
            )}
          </div>
        </section>

        <div className="space-y-5 lg:col-span-4">
          {/* Only when there's something to look at — an empty "all clear" card is just noise. */}
          {attention.length > 0 && (
            <Panel
              title="Needs attention"
              action={
                <Link to="/accounts/attention" className="text-xs text-muted-foreground hover:text-foreground">
                  {moreGaps ? `All ${gapItems.length} →` : "Details →"}
                </Link>
              }
            >
              <ul className="space-y-3">
                {attention.map((a, i) => (
                  <motion.li
                    key={a.id}
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.06, duration: 0.3 }}
                    className="flex items-start gap-3"
                  >
                    <span className="mt-0.5 text-warning [&_svg]:size-4">{a.icon}</span>
                    <span className="flex-1 text-sm leading-snug">{a.text}</span>
                    <span className="shrink-0">{a.action}</span>
                  </motion.li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Top movers today" action={<Link to="/portfolio" className="text-xs text-muted-foreground hover:text-foreground">All positions →</Link>}>
            {movers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No price moves yet today. Refresh prices to see them.</p>
            ) : (
              <ul className="divide-y">
                {movers.map(({ h, change }) => (
                  <li key={h.security.id}>
                    <Link to={`/portfolio/security/${h.security.id}`} className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-raised">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{displayName(h.security)}</span>
                        <span className="block truncate text-xs text-muted-foreground">{assetClassLabel(h.security.assetClass)}{h.security.sector ? ` · ${sectorLabel(h.security.sector)}` : ""}</span>
                      </span>
                      <span className={cn("shrink-0 text-sm font-semibold", change >= 0 ? "text-gain" : "text-loss")}>{signedMoney(change, data.baseCurrency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {allocation.length > 0 && <AllocationPanel data={data} />}
    </div>
  );
}

function Welcome() {
  const navigate = useNavigate();
  const { data: portfolios, isLoading } = usePortfolios();
  if (isLoading) return null;
  // Brand-new user: set up whose money this is (you, or your family) before the first import.
  if (!portfolios || portfolios.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="text-center">
          <p className="font-display text-5xl leading-tight">Welcome to Dhan Drishti.</p>
          <p className="mt-3 text-muted-foreground">First, whose money are we tracking? It takes a few seconds.</p>
        </div>
        <Onboarding />
      </div>
    );
  }
  return (
    <section className="mx-auto max-w-2xl rounded-2xl border bg-card p-10 text-center">
      <p className="font-display text-5xl leading-tight">Let's see where you stand.</p>
      <p className="mx-auto mt-4 max-w-md text-muted-foreground">
        Drop the files your brokers give you (Zerodha, Dhan, Vested, a CAS statement and more). Dhan Drishti sorts them out and builds your net
        worth. Nothing leaves this machine.
      </p>
      <Button size="lg" className="mt-8" onClick={() => navigate("/accounts")}>
        <Upload /> Add your first files
      </Button>
    </section>
  );
}

type AllocDim = "asset" | "sector" | "industry" | "region" | "currency" | "holdings";
const ALLOC_DIMS: { value: AllocDim; label: string }[] = [
  { value: "asset", label: "Asset class" },
  { value: "sector", label: "Sector" },
  { value: "industry", label: "Industry" },
  { value: "region", label: "Region" },
  { value: "currency", label: "Currency" },
  { value: "holdings", label: "Holdings" },
];
const SLICE_PALETTE = ["#f0b23e", "#5fb7a6", "#8c8fe0", "#d97757", "#7fa66b", "#c9a27e", "#d77fb3", "#7cc7d9", "#e3c07a", "#9dbf8c"];
const MAX_SLICES = 8;
const allocKey = "dd-home-allocation";

/**
 * How your money is spread, cut any way the data allows: asset class, sector, industry, region,
 * currency, or your biggest holdings. Beyond the top few, the rest fold into "Other".
 */
function AllocationPanel({ data }: { data: HoldingsResponse }) {
  const reduceMotion = useReducedMotion();
  const [dim, setDimState] = useState<AllocDim>(() => {
    try {
      const v = localStorage.getItem(allocKey) as AllocDim | null;
      return v && ALLOC_DIMS.some((d) => d.value === v) ? v : "asset";
    } catch {
      return "asset";
    }
  });
  const setDim = (d: AllocDim) => {
    setDimState(d);
    try {
      localStorage.setItem(allocKey, d);
    } catch {
      /* ignore */
    }
  };
  const a = data.allocation;
  const ccy = data.baseCurrency;

  const slices = useMemo(() => {
    let raw: { key: string; label: string; value: number }[];
    if (dim === "holdings") {
      const open = data.holdings.filter((h) => Number(h.netQty) > 0 && num(h.baseCurrentValue ?? h.baseInvested));
      raw = open.map((h) => ({ key: h.security.id, label: displayName(h.security), value: Number(h.baseCurrentValue ?? h.baseInvested) }));
      // Cash and other assets are part of the picture too.
      for (const s of a.byAssetClass) if (!data.holdings.some((h) => h.security.assetClass === s.key)) raw.push({ key: `class-${s.key}`, label: assetClassLabel(s.key), value: Number(s.value) });
    } else {
      const src = { asset: a.byAssetClass, sector: a.bySector, industry: a.bySubSector ?? [], region: a.byRegion ?? [], currency: a.byCurrency }[dim];
      const label = (k: string) => (dim === "asset" ? assetClassLabel(k) : dim === "sector" ? sectorLabel(k) : k);
      raw = src.map((s) => ({ key: s.key, label: label(s.key), value: Number(s.value) }));
    }
    raw = raw.filter((s) => s.value > 0).sort((x, y) => y.value - x.value);
    const total = raw.reduce((t, s) => t + s.value, 0) || 1;
    const top = raw.slice(0, MAX_SLICES);
    const rest = raw.slice(MAX_SLICES);
    if (rest.length) top.push({ key: "__other", label: `Other (${rest.length})`, value: rest.reduce((t, s) => t + s.value, 0) });
    return top.map((s, i) => ({
      ...s,
      weight: s.value / total,
      color: s.key === "__other" ? "#3a3a42" : dim === "asset" ? assetColor(s.key, i) : (SLICE_PALETTE[i % SLICE_PALETTE.length] ?? "#6f6f7a"),
    }));
  }, [a, data.holdings, dim]);

  return (
    <Panel
      title={`Allocation · by ${a.basis === "current_value" ? "current value" : "amount invested"}`}
      action={
        <div className="flex flex-wrap items-center gap-3">
          <Segmented ariaLabel="Break down by" size="xs" options={ALLOC_DIMS} value={dim} onChange={setDim} className="no-scrollbar max-w-full overflow-x-auto" />
          <Link to="/portfolio/allocation" className="text-xs text-muted-foreground hover:text-foreground">
            Details →
          </Link>
        </div>
      }
    >
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-raised" role="img" aria-label={`Allocation by ${ALLOC_DIMS.find((d) => d.value === dim)!.label.toLowerCase()}`}>
        {slices.map((slice, i) => (
          <motion.div
            key={`${dim}-${slice.key}`}
            initial={reduceMotion ? false : { width: 0 }}
            animate={{ width: `${slice.weight * 100}%` }}
            transition={{ delay: 0.05 + i * 0.04, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            style={{ backgroundColor: slice.color }}
            className="h-full border-r-2 border-card last:border-r-0"
            title={`${slice.label} · ${(slice.weight * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {slices.map((slice) => (
          <li key={`${dim}-${slice.key}`} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: slice.color }} />
            <span>{slice.label}</span>
            <span className="font-semibold">{(slice.weight * 100).toFixed(1)}%</span>
            <span className="text-muted-foreground">{compactMoney(slice.value, ccy)}</span>
          </li>
        ))}
      </ul>
      {slices.length === 0 && <p className="text-sm text-muted-foreground">Nothing to break down this way yet.</p>}
    </Panel>
  );
}
