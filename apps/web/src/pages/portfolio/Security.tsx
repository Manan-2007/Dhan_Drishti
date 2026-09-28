import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { StockChart, type StockMarker } from "@/components/charts/StockChart";
import { Segmented } from "@/components/kit/Segmented";
import { Panel } from "@/components/kit/Panel";
import { Stat } from "@/components/kit/Stat";
import { Empty } from "@/components/kit/Empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useFilter, useSecurityDetail } from "@/lib/hooks";
import { assetClassLabel, dateShort, money, num, qty, signedMoney, signedPct } from "@/lib/format";
import { readableContract } from "@/lib/instrument";
import { cn } from "@/lib/utils";

type Range = "1m" | "3m" | "6m" | "1y" | "max";
const RANGES: { value: Range; label: string; days: number | null }[] = [
  { value: "1m", label: "1M", days: 31 },
  { value: "3m", label: "3M", days: 92 },
  { value: "6m", label: "6M", days: 183 },
  { value: "1y", label: "1Y", days: 366 },
  { value: "max", label: "All", days: null },
];

const VERB: Record<string, string> = { buy: "Bought", sell: "Sold", dividend: "Dividend", bonus: "Bonus", split: "Split", transfer_in: "Moved in", transfer_out: "Moved out" };

/** One share, fund or contract: its price with your trades on it, your position, and every entry. */
export function Security() {
  const { id } = useParams();
  const { portfolioId } = useFilter();
  const { data, isLoading, isError } = useSecurityDetail(id, portfolioId);
  const [range, setRange] = useState<Range>("1y");

  const series = useMemo(() => {
    const all = data?.history ?? [];
    const days = RANGES.find((r) => r.value === range)!.days;
    const since = days === null ? "" : new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    return all.filter((b) => b.date >= since).map((b) => ({ time: b.date, value: b.close }));
  }, [data, range]);

  // A marker for each day you bought or sold (one per side per day).
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
    return <Empty title="Not found" body={`This isn't in your records${portfolioId ? " for the person selected" : ""}.`} action={<Link to="/portfolio" className="text-sm underline">Back to positions</Link>} />;
  }

  const s = data.security;
  const p = data.position;
  const cur = s.currency;
  const contract = readableContract(s.symbol);
  const title = contract?.title ?? s.symbol;
  const quote = p?.quote;
  const held = p && Number(p.netQty) !== 0;
  const netPnl = num(p?.netPnl) ?? 0;
  const portfolioNet = num(data.portfolioNetPnl) ?? 0;
  const share = portfolioNet ? netPnl / portfolioNet : null;
  const perUnitToday = p && num(p.todayChange) !== null && Number(p.netQty) ? Number(p.todayChange) / Number(p.netQty) : null;

  return (
    <div className="space-y-5">
      <Link to="/portfolio" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Positions
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl leading-none tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {[contract?.expiry ?? (s.name !== s.symbol ? s.name : null), assetClassLabel(s.assetClass), s.sector, s.exchange, cur !== "INR" ? cur : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        {quote && (
          <div className="text-right">
            <p className="text-3xl font-semibold tabular-nums">
              {quote.estimated && <span className="mr-1 text-lg text-muted-foreground" title="Estimated from the live underlying">≈</span>}
              {money(quote.price, cur)}
            </p>
            <p className="text-xs text-muted-foreground">
              {perUnitToday !== null && (
                <span className={cn("mr-1.5 font-semibold", perUnitToday >= 0 ? "text-gain" : "text-loss")}>{signedMoney(perUnitToday, cur, false)} today ·</span>
              )}
              as of {dateShort(quote.asOf)}
            </p>
          </div>
        )}
      </div>

      <Panel title="Price" action={<Segmented ariaLabel="Chart range" size="xs" options={RANGES.map(({ value, label }) => ({ value, label }))} value={range} onChange={setRange} />}>
        {series.length >= 2 ? (
          <>
            <StockChart points={series} markers={markers} currency={cur} height={320} />
            <p className="mt-3 text-xs text-muted-foreground">
              <span className="text-gain">▲</span> your buys · <span className="text-loss">▼</span> your sells
            </p>
          </>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {contract ? "Futures and options have no public daily prices to chart." : "No public price history for this one."}
          </p>
        )}
      </Panel>

      {p && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {held ? (
            <>
              <Stat label={Number(p.netQty) < 0 ? "Units (short)" : "Units"} value={qty(p.netQty)} sub={p.avgCost ? `at ${money(p.avgCost, cur)} average` : undefined} />
              <Stat label="Put in" value={money(Number(p.netQty) < 0 ? p.shortProceeds : p.invested, cur)} />
              <Stat label="Worth now" value={p.currentValue !== null ? money(p.currentValue, cur) : "—"} />
              <Stat
                label="On paper"
                value={p.unrealisedPnl !== null ? signedMoney(p.unrealisedPnl, cur, false) : "—"}
                tone={Number(p.unrealisedPnl) >= 0 ? "gain" : "loss"}
                sub={p.unrealisedPct !== null ? signedPct(p.unrealisedPct) : undefined}
              />
            </>
          ) : (
            <Stat label="Units" value="0" sub="Nothing held now" />
          )}
          <Stat label="Booked" value={signedMoney(p.realisedPnl, cur, false)} tone={Number(p.realisedPnl) > 0 ? "gain" : Number(p.realisedPnl) < 0 ? "loss" : undefined} sub="profit on what you sold" />
          <Stat label="Dividends" value={money(p.dividends, cur)} />
          <Stat
            label="Total"
            value={p.netPnl !== null ? signedMoney(p.netPnl, cur, false) : "—"}
            tone={netPnl >= 0 ? "gain" : "loss"}
            sub={share !== null && netPnl !== 0 ? `${(Math.abs(share) * 100).toFixed(1)}% of your total ${portfolioNet >= 0 ? "gain" : "loss"}` : undefined}
          />
        </div>
      )}

      <Panel title={`Your entries (${data.transactions.length})`}>
        <ul className="divide-y">
          {data.transactions.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="w-24 shrink-0 text-muted-foreground">{dateShort(t.tradeDate)}</span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  t.type === "buy" ? "bg-gain/15 text-gain" : t.type === "sell" ? "bg-loss/15 text-loss" : t.type === "dividend" ? "bg-primary/15 text-primary" : "bg-raised text-muted-foreground",
                )}
              >
                {t.sourceBroker === "snapshot" && t.type === "buy" ? "Opening balance" : (VERB[t.type] ?? t.type)}
              </span>
              <span className="flex-1 text-muted-foreground">
                {t.type === "split" ? `×${Number(t.price)} units` : Number(t.quantity) ? `${qty(t.quantity)} @ ${money(t.price, t.currency)}` : ""}
                {t.sourceBroker === "expiry" && " · settled at expiry, estimated"}
              </span>
              <span className="font-semibold tabular-nums">{money(t.grossAmount, t.currency)}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
