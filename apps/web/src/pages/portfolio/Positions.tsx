import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { ChevronDown, ChevronsUpDown, ArrowDown, ArrowUp, ChartCandlestick, Newspaper, RefreshCw, Search, Upload } from "lucide-react";
import { stockHref } from "@/components/StockLinks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScopeSelect } from "@/components/shell/ScopeSelect";
import { useFilter, useHoldings } from "@/lib/hooks";
import { useMarketStatus, useRefreshPrices } from "@/lib/prices";
import { assetColor } from "@/lib/assetColors";
import { Heatmap, type HeatItem } from "@/components/charts/AllocationViz";
import { ago, assetClassLabel, compactMoney, money, num, qty, signedMoney, signedPct } from "@/lib/format";
import type { HoldingRow } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Empty } from "@/components/kit/Empty";
import { Stat } from "@/components/kit/Stat";
import { readableContract } from "@/lib/instrument";
import { useMoneyView } from "@/lib/money-view";

type SortKey = "security" | "value" | "invested" | "pnl" | "pnlPct" | "today" | "weight";

const COLS: { key: SortKey | null; label: string; hint: string; align: "left" | "right" }[] = [
  { key: "security", label: "Security", hint: "What you hold, with its sector", align: "left" },
  { key: null, label: "Qty", hint: "Units held. Negative means a short position (sold before buying).", align: "right" },
  { key: null, label: "Avg price", hint: "Average price you paid per unit (for a short: the average price you sold at)", align: "right" },
  { key: "invested", label: "Invested", hint: "Money put into what you still hold (for a short: the credit you received)", align: "right" },
  { key: "value", label: "Value", hint: "What it is worth at the latest price", align: "right" },
  { key: "pnl", label: "P&L", hint: "Gain or loss on paper for what you still hold; not locked in until you sell", align: "right" },
  { key: "today", label: "Today", hint: "How much the value moved since yesterday's close", align: "right" },
  { key: "weight", label: "Weight", hint: "Share of your investments", align: "right" },
];

const base = (h: HoldingRow, v: string | null) => {
  const local = num(v);
  const bl = num(h.baseCurrentValue);
  const l = num(h.currentValue);
  if (local === null) return null;
  return bl !== null && l !== null && l !== 0 ? local * (bl / l) : local;
};

function sortValue(h: HoldingRow, key: SortKey, total: number): number | string | null {
  switch (key) {
    case "security":
      return h.security.symbol;
    case "value":
      return num(h.baseCurrentValue) ?? num(h.baseInvested);
    case "invested":
      return num(h.baseInvested);
    case "pnl":
      return num(h.baseUnrealisedPnl);
    case "pnlPct":
      return num(h.unrealisedPct);
    case "today":
      return base(h, h.todayChange);
    case "weight": {
      const v = num(h.baseCurrentValue);
      return v !== null && total > 0 ? v / total : null;
    }
  }
}

function HeadCell({ col, sortKey, dir, onSort }: { col: (typeof COLS)[number]; sortKey: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void }) {
  const active = col.key !== null && sortKey === col.key;
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
  const content = (
    <span className={cn("inline-flex items-center gap-1", col.align === "right" && "flex-row-reverse")}>
      {col.label}
      {col.key && <Icon className={cn("size-3", !active && "opacity-40")} />}
    </span>
  );
  return (
    <th className={cn("px-3 py-3 text-xs font-medium tracking-wide text-muted-foreground uppercase", col.align === "right" ? "text-right" : "text-left")}>
      <Tooltip>
        <TooltipTrigger asChild>
          {col.key ? (
            <button type="button" onClick={() => onSort(col.key!)} className={cn("cursor-pointer tracking-wide uppercase hover:text-foreground", active && "text-foreground")}>
              {content}
            </button>
          ) : (
            <span className="cursor-help">{content}</span>
          )}
        </TooltipTrigger>
        <TooltipContent className="max-w-60">{col.hint}</TooltipContent>
      </Tooltip>
    </th>
  );
}

export function Positions() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { scope } = useFilter();
  const { data, isLoading } = useHoldings(scope);
  const view = useMoneyView();
  const status = useMarketStatus();
  const refresh = useRefreshPrices();
  const [search, setSearch] = useState("");
  const [showMap, setShowMap] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const all = data?.holdings ?? [];
  const q = search.trim().toLowerCase();
  const matching = q ? all.filter((h) => h.security.symbol.toLowerCase().includes(q) || h.security.name.toLowerCase().includes(q)) : all;
  const open = matching.filter((h) => Number(h.netQty) !== 0);
  const closedCount = matching.length - open.length;
  const rows = showClosed ? matching : open;
  const totalValue = useMemo(() => open.reduce((a, h) => a + (num(h.baseCurrentValue) ?? 0), 0), [open]);

  const groups = useMemo(() => {
    const map = new Map<string, HoldingRow[]>();
    for (const h of rows) {
      const k = h.security.assetClass;
      map.set(k, [...(map.get(k) ?? []), h]);
    }
    const cmp = (a: HoldingRow, b: HoldingRow) => {
      const va = sortValue(a, sortKey, totalValue);
      const vb = sortValue(b, sortKey, totalValue);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const c = typeof va === "string" || typeof vb === "string" ? String(va).localeCompare(String(vb)) : va - vb;
      return dir === "asc" ? c : -c;
    };
    return [...map.entries()]
      .map(([key, items]) => {
        const value = items.reduce((a, h) => a + (num(h.baseCurrentValue) ?? num(h.baseInvested) ?? 0), 0);
        const pnl = items.reduce((a, h) => a + (num(h.baseUnrealisedPnl) ?? 0), 0);
        return { key, items: [...items].sort(cmp), value, pnl };
      })
      .sort((a, b) => b.value - a.value);
  }, [rows, sortKey, dir, totalValue]);

  const onSort = (k: SortKey) => {
    if (k === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setDir(k === "security" ? "asc" : "desc");
    }
  };
  const toggleGroup = (k: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  if (isLoading) return <Skeleton className="h-[520px] rounded-2xl" />;
  if (all.length === 0) {
    return (
      <Empty
        title="No positions yet"
        body="Add the files from your broker and your holdings appear here, grouped and priced."
        action={<Button onClick={() => navigate("/accounts")}><Upload /> Add files</Button>}
      />
    );
  }

  const s = data!.summary;
  const ccy = data!.baseCurrency;

  // Today's movers: priced positions, sized by worth, coloured by how much they moved since yesterday.
  const heatItems: HeatItem[] = data!.holdings
    .filter((h) => Number(h.netQty) !== 0 && h.baseCurrentValue !== null)
    .map((h) => {
      const cv = num(h.currentValue);
      const tc = num(h.todayChange);
      const prev = cv !== null && tc !== null ? cv - tc : null;
      return {
        key: h.security.id,
        label: h.security.symbol,
        name: h.security.name,
        detail: `${compactMoney(h.baseCurrentValue!, ccy)} held`,
        value: Number(h.baseCurrentValue),
        changePct: prev && prev !== 0 && tc !== null ? tc / prev : null,
      };
    });
  const hasMovers = heatItems.some((h) => h.changePct !== null);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Value" value={compactMoney(s.currentValue, ccy)} title={money(s.currentValue, ccy)} />
        <Stat label="Invested" value={compactMoney(s.invested, ccy)} title={money(s.invested, ccy)} />
        <Stat
          label="Unrealised P&L"
          value={signedMoney(s.unrealisedPnl, ccy)}
          tone={Number(s.unrealisedPnl) >= 0 ? "gain" : "loss"}
          sub={num(s.invested) ? signedPct(Number(s.unrealisedPnl) / Number(s.invested)) : undefined}
        />
        <Stat label="Open positions" value={String(s.openPositions)} sub={s.pricedPositions < s.openPositions ? `${s.openPositions - s.pricedPositions} without a price` : "all priced"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search holdings" className="h-10 rounded-full pl-10" aria-label="Search holdings" />
        </div>
        <ScopeSelect currency />
        {closedCount > 0 && (
          <Button variant={showClosed ? "secondary" : "outline"} size="sm" onClick={() => setShowClosed((v) => !v)} aria-pressed={showClosed}>
            {showClosed ? "Hide" : "Show"} {closedCount} closed
          </Button>
        )}
        {heatItems.length > 0 && (
          <Button variant={showMap ? "secondary" : "outline"} size="sm" onClick={() => setShowMap((v) => !v)} aria-pressed={showMap}>
            {showMap ? "Hide heatmap" : "Heatmap"}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span>Prices {ago(status.data?.lastUpdated)}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={refresh.isPending}
            onClick={() =>
              toast.promise(refresh.mutateAsync(), {
                loading: "Refreshing prices…",
                success: (r) => `Priced ${r.updated} of ${r.requested}${r.failed ? ` · ${r.failed} without a price` : ""}`,
                error: "Couldn't refresh prices",
              })
            }
          >
            <RefreshCw className={cn(refresh.isPending && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {showMap && heatItems.length > 0 && (
        <section className="rounded-2xl border bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Today's movers</p>
            <p className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-gain" /> up</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-loss" /> down</span>
              <span>· size = worth</span>
            </p>
          </div>
          <div className="mt-4">
            <Heatmap items={heatItems} height={320} />
          </div>
          {!hasMovers && <p className="mt-3 text-center text-xs text-muted-foreground">No price moves since yesterday yet — refresh prices to see them.</p>}
        </section>
      )}

      {rows.length === 0 ? (
        <Empty title="Nothing matches" body="Try a different search, or show closed positions." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b">
              <tr>
                {COLS.map((c) => (
                  <HeadCell key={c.label} col={c} sortKey={sortKey} dir={dir} onSort={onSort} />
                ))}
              </tr>
            </thead>
            {groups.map((g, gi) => {
              const isCollapsed = collapsed.has(g.key);
              return (
                <tbody key={g.key} className="border-b last:border-b-0">
                  <tr
                    className="cursor-pointer bg-raised/40 transition-colors hover:bg-raised"
                    onClick={() => toggleGroup(g.key)}
                    aria-expanded={!isCollapsed}
                  >
                    <td className="px-3 py-2.5" colSpan={4}>
                      <span className="flex items-center gap-2.5">
                        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-200", isCollapsed && "-rotate-90")} />
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: assetColor(g.key, gi) }} />
                        <span className="font-semibold">{assetClassLabel(g.key)}</span>
                        <span className="text-muted-foreground">{g.items.length}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold">{compactMoney(g.value, ccy)}</td>
                    <td className={cn("px-3 py-2.5 text-right font-semibold", g.pnl >= 0 ? "text-gain" : "text-loss")}>{signedMoney(g.pnl, ccy)}</td>
                    <td />
                    <td className="px-3 py-2.5 text-right text-muted-foreground">{totalValue > 0 ? `${((g.value / totalValue) * 100).toFixed(1)}%` : "—"}</td>
                  </tr>
                  <AnimatePresence initial={false}>
                    {!isCollapsed &&
                      g.items.map((h) => (
                        <motion.tr
                          key={h.security.id}
                          initial={reduceMotion ? false : { opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.18 }}
                          className="group cursor-pointer border-t border-border/60 transition-colors hover:bg-raised/60"
                          onClick={() => navigate(`/portfolio/security/${h.security.id}`)}
                        >
                          <PositionCells h={h} totalValue={totalValue} />
                        </motion.tr>
                      ))}
                  </AnimatePresence>
                </tbody>
              );
            })}
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {all.some((h) => h.security.currency !== ccy)
          ? view.on
            ? `Everything in ${ccy}: US holdings are worth today's rate, and their cost is at the rate on each buy day — so their profit includes the dollar's move. `
            : `Each row in its own currency; group totals in ${ccy}. `
          : `Values in ${ccy}. `}
        ≈ marks an estimated price (options and futures, from the live underlying). Click any row for its full history.</p>
    </div>
  );
}

function PositionCells({ h, totalValue }: { h: HoldingRow; totalValue: number }) {
  const short = Number(h.netQty) < 0;
  const closed = Number(h.netQty) === 0;
  const today = base(h, h.todayChange);
  const value = num(h.baseCurrentValue);
  const weight = value !== null && totalValue > 0 ? value / totalValue : null;
  const pnl = num(h.baseUnrealisedPnl);
  const v = useMoneyView().holding(h);
  const cur = v.cur;
  const contract = readableContract(h.security.symbol);
  return (
    <>
      <td className="max-w-[240px] px-3 py-3">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold" title={h.security.symbol}>{contract?.title ?? h.security.symbol}</span>
          {short && !h.expired && <Badge variant="warning">short</Badge>}
          {h.expired && (
            <Badge variant="warning" title="Past its expiry, but your files don't show it closing and there's no public price to settle it. Add the tradebook that closed it.">
              expired
            </Badge>
          )}
          {closed && <Badge variant="muted">closed</Badge>}
          {/* Jump straight to this stock's research or news; the row itself opens the holding. */}
          <span className="ml-auto flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            <RowLink to={stockHref.research(h.security.id)} label={`Research ${h.security.symbol}`}>
              <ChartCandlestick />
            </RowLink>
            {h.security.assetClass === "equity" && (
              <RowLink to={stockHref.news(h.security.id)} label={`News on ${h.security.symbol}`}>
                <Newspaper />
              </RowLink>
            )}
          </span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {contract ? contract.expiry : h.security.name !== h.security.symbol ? h.security.name : assetClassLabel(h.security.assetClass)}
          {!contract && h.security.sector ? ` · ${h.security.sector}` : ""}
        </span>
      </td>
      <td className="px-3 py-3 text-right whitespace-nowrap">{closed ? "—" : qty(h.netQty)}</td>
      <td className="px-3 py-3 text-right whitespace-nowrap">{closed ? "—" : money(v.avgCost, cur)}</td>
      <td className="px-3 py-3 text-right whitespace-nowrap">{closed ? "—" : money(v.invested, cur)}</td>
      <td className="px-3 py-3 text-right whitespace-nowrap font-semibold">
        {h.quote?.estimated && (
          <span className="mr-1 font-normal text-muted-foreground" title="Estimated from the live underlying — not an exchange price">
            ≈
          </span>
        )}
        {closed ? "—" : money(v.value, cur)}
      </td>
      <td className={cn("px-3 py-3 text-right whitespace-nowrap", pnl === null ? "text-muted-foreground" : pnl >= 0 ? "text-gain" : "text-loss")}>
        {closed ? (
          <span className={cn((v.realised ?? 0) >= 0 ? "text-gain" : "text-loss")} title="Realised on this closed position">
            {signedMoney(v.realised, cur, false)} <span className="text-xs text-muted-foreground">realised</span>
          </span>
        ) : pnl === null ? (
          "—"
        ) : (
          <>
            {signedMoney(v.pnl, cur, false)}
            {v.pnlPct !== null && <span className="ml-1 text-xs opacity-80">{signedPct(v.pnlPct, 1)}</span>}
          </>
        )}
      </td>
      <td className={cn("px-3 py-3 text-right whitespace-nowrap", today === null ? "text-muted-foreground" : today >= 0 ? "text-gain" : "text-loss")}>
        {today === null ? "—" : signedMoney(v.today, cur)}
      </td>
      <td className="px-3 py-3 text-right whitespace-nowrap text-muted-foreground">{weight === null ? "—" : `${(weight * 100).toFixed(1)}%`}</td>
    </>
  );
}

function RowLink({ to, label, children }: { to: string; label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={to}
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-primary [&_svg]:size-4"
        >
          {children}
        </Link>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
