import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, HelpCircle, TrendingDown, TrendingUp, Upload } from "lucide-react";
import CountUp from "@/components/reactbits/CountUp";
import { CompareChart } from "@/components/charts/CompareChart";
import { Segmented } from "@/components/kit/Segmented";
import { Panel } from "@/components/kit/Panel";
import { Empty } from "@/components/kit/Empty";
import { ScopeSelect } from "@/components/shell/ScopeSelect";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBenchmark, useBenchmarks, useFilter, useHoldings, usePerformance, useTwr } from "@/lib/hooks";
import { compactMoney, money, num, signedMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const SEGMENTS: Record<string, string> = { equity: "Shares & ETFs", mf: "Mutual funds", fno: "Futures & options", commodity: "Commodities", other: "Other" };

const yearly = (r: number) => `${r >= 0 ? "+" : "−"}${Math.abs(r * 100).toFixed(1)}%`;

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

export function Returns() {
  const navigate = useNavigate();
  const { portfolioId } = useFilter();
  const { data, isLoading } = usePerformance(portfolioId);
  const { data: holdings } = useHoldings(portfolioId);
  const reduceMotion = useReducedMotion();

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }
  if (!data || (data.summary.openPositions === 0 && data.byFY.length === 0)) {
    return (
      <Empty
        title="Nothing to measure yet"
        body="Once your trades are in, this shows how fast your money is growing and how that compares with the market."
        action={
          <Button onClick={() => navigate("/accounts")}>
            <Upload /> Add files
          </Button>
        }
      />
    );
  }

  const s = data.summary;
  const ccy = holdings?.baseCurrency ?? "INR";
  const total = num(s.netPnl) ?? 0;
  const up = total >= 0;
  const xirrReady = data.xirrAvailable && data.xirr !== null;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <ScopeSelect />
      </div>

      <section className="rounded-2xl border bg-card p-6">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Total gain</p>
          <Hint>Everything your investments have made since your files begin: the gain on what you still hold, profit booked on what you sold, and dividends received.</Hint>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
          <p className={cn("font-display text-6xl leading-none tracking-tight sm:text-7xl", up ? "text-gain" : "text-loss")} title={money(total, ccy)}>
            <CountUp to={total} format={(n) => signedMoney(n, ccy)} />
          </p>
          {xirrReady && (
            <motion.p
              initial={reduceMotion ? false : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35, duration: 0.3 }}
              className={cn("mb-1.5 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold", data.xirr! >= 0 ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss")}
            >
              {data.xirr! >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
              growing {yearly(data.xirr!)} a year
            </motion.p>
          )}
        </div>
        <dl className="mt-6 grid gap-3 sm:grid-cols-3">
          <Part label="On paper" hint="Gain on what you still hold, at today's prices. It becomes real only when you sell." value={s.unrealisedPnl} ccy={ccy} />
          <Part label="Booked" hint="Profit or loss locked in on what you've sold, after charges." value={s.realisedPnl} ccy={ccy} />
          <Part label="Dividends" hint="Dividends and interest paid out to you." value={s.dividends} ccy={ccy} />
        </dl>
        {!xirrReady && (
          <p className="mt-4 text-sm text-muted-foreground">
            The yearly growth rate appears once every open position has a current price{s.allPriced ? " and every foreign trade has an exchange rate" : ""}.
          </p>
        )}
      </section>

      <BenchmarkPanel />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Booked profit by financial year">
          <Bars
            rows={[...data.byFY].reverse().map((f) => ({ key: f.key, label: f.key, value: Number(f.realised), note: Number(f.dividends) ? `+ ${compactMoney(f.dividends, ccy)} dividends` : undefined }))}
            ccy={ccy}
          />
        </Panel>
        <Panel title="Booked profit by kind">
          <Bars rows={data.bySegment.map((g) => ({ key: g.key, label: SEGMENTS[g.key] ?? g.key, value: Number(g.realised) }))} ccy={ccy} />
        </Panel>
      </div>

      <MoreDetail />
    </div>
  );
}

function Part({ label, hint, value, ccy }: { label: string; hint: string; value: string; ccy: string }) {
  const n = num(value) ?? 0;
  return (
    <div className="rounded-xl bg-raised/50 px-4 py-3">
      <dt className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label} <Hint>{hint}</Hint>
      </dt>
      <dd className={cn("mt-1 text-xl font-semibold", n > 0 && "text-gain", n < 0 && "text-loss")} title={money(value, ccy)}>
        {signedMoney(value, ccy)}
      </dd>
    </div>
  );
}

/** Horizontal bars, one per row, scaled to the largest magnitude; gains right in green, losses in red. */
function Bars({ rows, ccy }: { rows: { key: string; label: string; value: number; note?: string }[]; ccy: string }) {
  const reduceMotion = useReducedMotion();
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing sold yet, so no profit is booked.</p>;
  return (
    <ul className="space-y-3.5">
      {rows.map((r, i) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>{r.label}</span>
            <span className={cn("font-semibold tabular-nums", r.value > 0 && "text-gain", r.value < 0 && "text-loss")} title={money(r.value, ccy)}>
              {signedMoney(r.value, ccy)}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-raised">
            <motion.div
              initial={reduceMotion ? false : { width: 0 }}
              animate={{ width: `${(Math.abs(r.value) / max) * 100}%` }}
              transition={{ delay: 0.1 + i * 0.05, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className={cn("h-full rounded-full", r.value >= 0 ? "bg-gain" : "bg-loss")}
            />
          </div>
          {r.note && <p className="mt-1 text-xs text-muted-foreground">{r.note}</p>}
        </li>
      ))}
    </ul>
  );
}

function BenchmarkPanel() {
  const { portfolioId } = useFilter();
  const { data: list } = useBenchmarks();
  const [id, setId] = useState("nifty50");
  const { data, isLoading } = useBenchmark(portfolioId, id);
  const options = (list ?? [{ id: "nifty50", label: "Nifty 50" }]).map((b) => ({ value: b.id, label: b.label }));
  const lines = useMemo(
    () =>
      data?.series && data.series.length >= 2
        ? [
            { label: "What you put in", color: "#9c978c", points: data.series.map((p) => ({ time: p.date.slice(0, 10), value: p.invested })), dashed: true },
            { label: `The same money in ${data.label}`, color: "#f0b23e", points: data.series.map((p) => ({ time: p.date.slice(0, 10), value: p.index })) },
          ]
        : null,
    [data],
  );
  const you = data?.portfolio?.xirr ?? null;
  const them = data?.index?.xirr ?? null;
  const ahead = you !== null && them !== null ? you - them : null;

  return (
    <Panel
      title="Against the market"
      action={<Segmented ariaLabel="Index to compare with" size="xs" options={options} value={id} onChange={setId} className="no-scrollbar max-w-full overflow-x-auto" />}
    >
      {isLoading || !data ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <div className="space-y-5">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every rupee you put in and took out, on the same days, as if it had gone into {data.label} instead.
          </p>
          {data.available && you !== null && them !== null ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Figure label="You" value={`${yearly(you)} a year`} tone={you >= 0 ? "gain" : "loss"} sub={`worth ${compactMoney(data.portfolio!.currentValue)} today`} />
              <Figure label={data.label} value={`${yearly(them)} a year`} tone={them >= 0 ? "gain" : "loss"} sub={`would be ${compactMoney(data.index!.currentValue)}`} />
              <Figure
                label="Difference"
                value={ahead! >= 0 ? `${(ahead! * 100).toFixed(1)} pts ahead` : `${(Math.abs(ahead!) * 100).toFixed(1)} pts behind`}
                tone={ahead! >= 0 ? "gain" : "loss"}
                sub={ahead! >= 0 ? "You beat the index" : "The index did better"}
              />
            </div>
          ) : (
            <p className="rounded-xl bg-raised/50 px-4 py-3 text-sm">{data.reason ?? "This comparison isn't ready yet."}</p>
          )}
          {lines && <CompareChart lines={lines} height={240} />}
          {data.currencyNote && <p className="text-xs text-muted-foreground">{data.currencyNote}</p>}
        </div>
      )}
    </Panel>
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "gain" | "loss" }) {
  return (
    <div className="rounded-xl bg-raised/50 px-4 py-3">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold", tone === "gain" ? "text-gain" : "text-loss")}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

/** For the curious: the time-weighted return and what currency moves did to foreign holdings. */
function MoreDetail() {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const { portfolioId } = useFilter();
  const twr = useTwr(portfolioId, open);
  const { data: holdings } = useHoldings(portfolioId);
  const fx = holdings?.fxImpact;
  const ccy = holdings?.baseCurrency ?? "INR";
  return (
    <section className="rounded-2xl border bg-card">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full cursor-pointer items-center justify-between px-5 py-4 text-left">
        <span>
          <span className="block text-sm font-semibold">More detail</span>
          <span className="block text-xs text-muted-foreground">Time-weighted return, and how exchange rates moved your foreign holdings</span>
        </span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="grid gap-5 border-t px-5 py-5 lg:grid-cols-2">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Time-weighted return
                  <Hint>How the investments themselves performed, ignoring when you added or took out money. Fund managers are measured this way.</Hint>
                </p>
                {twr.isLoading ? (
                  <Skeleton className="mt-2 h-16 rounded-xl" />
                ) : twr.data?.available ? (
                  <div className="mt-2">
                    <p className={cn("text-2xl font-semibold", (twr.data.annualized ?? twr.data.twr ?? 0) >= 0 ? "text-gain" : "text-loss")}>
                      {twr.data.annualized !== null && twr.data.annualized !== undefined ? `${yearly(twr.data.annualized)} a year` : yearly(twr.data.twr ?? 0)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {yearly(twr.data.twr ?? 0)} in all since {twr.data.from}
                      {twr.data.mode === "cash-inclusive" && " · cash and dividends included"}
                      {twr.data.mode === "mixed" && " · cash counted where deposits are recorded"}
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">{twr.data?.reason ?? "Not available."}</p>
                )}
              </div>
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Currency effect
                  <Hint>For holdings bought in another currency (US shares, say): how much of the gain came from the shares themselves and how much from the rupee moving.</Hint>
                </p>
                {fx && fx.decomposablePositions > 0 ? (
                  <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">From the shares</dt>
                      <dd className="font-semibold">{signedMoney(fx.assetReturn, ccy)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">From the exchange rate</dt>
                      <dd className="font-semibold">{signedMoney(fx.currencyReturn, ccy)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Together</dt>
                      <dd className="font-semibold">{signedMoney(fx.total, ccy)}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {fx ? "Exchange rates for your foreign purchases are still being filled in. They arrive automatically." : "No foreign holdings, so there's no currency effect."}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
