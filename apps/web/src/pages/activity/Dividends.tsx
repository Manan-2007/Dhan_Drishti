import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { HelpCircle } from "lucide-react";
import { Panel } from "@/components/kit/Panel";
import { Stat } from "@/components/kit/Stat";
import { Empty } from "@/components/kit/Empty";
import { Segmented } from "@/components/kit/Segmented";
import { NoMatch, ScopeSelect } from "@/components/shell/ScopeSelect";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDividends, useFilter, type DividendCadence } from "@/lib/hooks";
import { compactMoney, dateShort, money, pct } from "@/lib/format";
import { displayName } from "@/lib/instrument";
import { cn } from "@/lib/utils";

const CADENCE: Record<DividendCadence, string> = {
  monthly: "every month",
  quarterly: "every quarter",
  "half-yearly": "twice a year",
  annual: "once a year",
  irregular: "irregularly",
  "one-off": "once so far",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Hint({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex cursor-help text-muted-foreground hover:text-foreground" aria-label="What does this mean?">
          <HelpCircle className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}

/** Money your holdings paid you: when, from what, and roughly when the next payouts are due. */
export function Dividends() {
  const { scope, active, usInBase } = useFilter();
  const { data, isLoading } = useDividends(scope);
  const reduceMotion = useReducedMotion();
  const [span, setSpan] = useState<"12" | "24">("12");

  // Income per calendar month, oldest first, in the base currency.
  const months = useMemo(() => {
    if (!data) return [];
    const now = new Date();
    const n = Number(span);
    const list = Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1));
      return { key: d.toISOString().slice(0, 7), label: MONTHS[d.getUTCMonth()]!, year: d.getUTCFullYear(), amount: 0 };
    });
    const at = new Map(list.map((m) => [m.key, m]));
    for (const e of data.events) {
      const m = at.get(e.tradeDate.slice(0, 7));
      if (m) m.amount += Number(e.baseAmount ?? 0);
    }
    return list;
  }, [data, span]);

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }
  if (!data || data.count === 0) {
    if (active) return <NoMatch what="dividends" />;
    return <Empty title="No dividends yet" body="Dividends and interest from your broker statements show up here — every one a real payout, never a projection." />;
  }

  const ccy = data.baseCurrency;
  const peak = Math.max(1, ...months.map((m) => m.amount));
  const topMax = Math.max(1, ...data.bySecurity.slice(0, 8).map((s) => Number(s.amount)));
  const soon = [...data.upcoming].filter((u) => u.estimatedNext).sort((a, b) => (a.estimatedNext! < b.estimatedNext! ? -1 : 1));

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <ScopeSelect currency />
      </div>
      {!data.fxComplete && (
        <p className="rounded-2xl border border-warning/40 bg-card px-4 py-3 text-sm">
          Some payouts are in {data.unconvertibleCurrencies.join(", ")} and wait for an exchange rate, so they're not in the totals yet. Rates fill in automatically.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Last 12 months" value={compactMoney(data.income.ttm, ccy)} tone="gain" title={money(data.income.ttm, ccy)} />
        <div className="rounded-2xl border bg-card px-5 py-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Yield <Hint>The last year's payouts from what you hold today, as a share of what it's worth. A rough guide to what the next year might pay.</Hint>
          </p>
          <p className="mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl">{data.income.trailingYield ? pct(data.income.trailingYield) : "—"}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{data.income.portfolioValue ? `on ${compactMoney(data.income.portfolioValue, ccy)} held` : "needs current prices"}</p>
        </div>
        <Stat label="All time" value={compactMoney(data.total, ccy)} title={money(data.total, ccy)} sub={`${data.count} payouts`} />
        <Stat label="Paying holdings" value={String(data.bySecurity.length)} />
      </div>

      <Panel title="Income by month" action={<Segmented ariaLabel="Months shown" size="xs" options={[{ value: "12", label: "12M" }, { value: "24", label: "24M" }]} value={span} onChange={setSpan} />}>
        <div className="flex h-48 items-end gap-1.5">
          {months.map((m, i) => (
            <Tooltip key={m.key}>
              <TooltipTrigger asChild>
                <div className="group flex h-full flex-1 flex-col justify-end">
                  <motion.div
                    initial={reduceMotion ? false : { height: 0 }}
                    animate={{ height: `${(m.amount / peak) * 100}%` }}
                    transition={{ delay: 0.02 * i, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    className={cn("min-h-[3px] rounded-t-md transition-colors", m.amount ? "bg-primary group-hover:bg-[#f5c261]" : "bg-raised")}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {m.label} {m.year}: {money(m.amount, ccy)}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5 text-[10px] text-muted-foreground">
          {months.map((m, i) => (
            <span key={m.key} className="flex-1 text-center">
              {span === "12" || i % 2 === 0 ? (m.label === "Jan" ? `${m.label} ${String(m.year).slice(2)}` : m.label) : ""}
            </span>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Who pays you most">
          <ul className="space-y-3">
            {data.bySecurity.slice(0, 8).map((s, i) => (
              <li key={s.symbol}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate" title={s.name}>
                    {displayName(s)}
                  </span>
                  <span className="shrink-0 font-semibold text-gain tabular-nums">{money(s.amount, ccy)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised">
                  <motion.div
                    initial={reduceMotion ? false : { width: 0 }}
                    animate={{ width: `${(Number(s.amount) / topMax) * 100}%` }}
                    transition={{ delay: 0.05 * i, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    className="h-full rounded-full bg-gain"
                  />
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Expected next">
          {soon.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not enough payout history yet to tell when the next ones come.</p>
          ) : (
            <ul className="divide-y">
              {soon.slice(0, 8).map((u) => (
                <li key={u.security.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <Link to={`/portfolio/security/${u.security.id}`} className="block truncate font-semibold hover:underline">
                      {displayName(u.security)}
                    </Link>
                    <span className="text-xs text-muted-foreground">pays {CADENCE[u.cadence]} · last {money(u.lastAmount ?? "0", ccy)}</span>
                  </span>
                  <span className="shrink-0 text-right text-muted-foreground">around {dateShort(u.estimatedNext!)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Guessed from each holding's own past payouts, not announced by the company.</p>
        </Panel>
      </div>

      <Panel title={`Every payout (${data.count})`}>
        <ul className="divide-y">
          {data.events.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="w-24 shrink-0 text-muted-foreground">{dateShort(e.tradeDate)}</span>
              <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", e.type === "dividend" ? "bg-primary/15 text-primary" : "bg-raised text-muted-foreground")}>
                {e.type === "dividend" ? "Dividend" : "Interest"}
              </span>
              <span className="min-w-0 flex-1 truncate">{e.security ? displayName(e.security) : "—"}</span>
              <span className="shrink-0 font-semibold text-gain tabular-nums">
                {usInBase && e.currency !== ccy && e.baseAmount ? (
                  <>
                    +{money(e.baseAmount, ccy)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">({money(e.amount, e.currency)})</span>
                  </>
                ) : (
                  <>
                    +{money(e.amount, e.currency)}
                    {e.currency !== ccy && e.baseAmount && <span className="ml-1 text-xs font-normal text-muted-foreground">({money(e.baseAmount, ccy)})</span>}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
