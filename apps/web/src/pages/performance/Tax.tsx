import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Download, HelpCircle, Upload } from "lucide-react";
import { Segmented } from "@/components/kit/Segmented";
import { Panel } from "@/components/kit/Panel";
import { Empty } from "@/components/kit/Empty";
import { ScopeSelect } from "@/components/shell/ScopeSelect";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCapitalGains, useFilter } from "@/lib/hooks";
import { dateShort, financialYear, money, qty, signedMoney } from "@/lib/format";
import { displayName } from "@/lib/instrument";
import type { CapitalGainRow, TermTotals } from "@/lib/api";
import { cn } from "@/lib/utils";

const ZERO: TermTotals = { gain: "0", proceeds: "0", cost: "0", count: 0 };

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

function toCsv(rows: CapitalGainRow[], base: string): string {
  const head = ["Security", "Name", "Bought", "Sold", "Units", `Sale value (${base})`, `Cost (${base})`, `Gain (${base})`, "Term", "Days held", "Currency"];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = rows.map((r) =>
    [r.symbol, r.name, r.buyDateKnown ? r.buyDate : "before files start", r.sellDate, r.quantity, r.proceedsBase ?? "", r.costBase ?? "", r.gainBase ?? "", !r.buyDateKnown ? "Unknown" : r.term === "long" ? "Long-term" : "Short-term", r.buyDateKnown ? String(r.holdingDays) : "", r.currency]
      .map(esc)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

/** Capital gains by financial year, the way the tax return asks for them. */
export function Tax() {
  const navigate = useNavigate();
  const { portfolioId } = useFilter();
  const { data, isLoading } = useCapitalGains(portfolioId);
  const [fy, setFy] = useState<string>("");

  useEffect(() => {
    if (data && !fy) setFy(data.fyList[0] ?? "all"); // open on the latest year
  }, [data, fy]);

  const rows = useMemo(() => (data ? (fy === "all" ? data.rows : data.rows.filter((r) => financialYear(r.sellDate) === fy)) : []), [data, fy]);
  const unmatched = useMemo(() => (data ? (fy === "all" ? data.unmatched : data.unmatched.filter((u) => u.fy === fy)) : []), [data, fy]);
  const totals = useMemo(() => {
    if (!data) return null;
    if (fy === "all") return data.totals;
    return data.byFY.find((f) => f.key === fy) ?? { shortTerm: ZERO, longTerm: ZERO, unknownTerm: ZERO };
  }, [data, fy]);

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }
  if (!data || (data.rows.length === 0 && data.unmatched.length === 0)) {
    return (
      <Empty
        title="No capital gains yet"
        body="When you sell shares, ETFs or funds, the gains show up here by financial year — short-term and long-term, the way your tax return asks for them."
        action={
          <Button onClick={() => navigate("/accounts")}>
            <Upload /> Add files
          </Button>
        }
      />
    );
  }

  const base = data.baseCurrency;
  const unmatchedValue = unmatched.reduce((s, u) => s + Number(u.proceedsBase ?? 0), 0);
  const download = () => {
    const blob = new Blob([toCsv(rows, base)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `capital-gains-${fy === "all" ? "all-years" : fy.replace(/\s+/g, "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          ariaLabel="Financial year"
          options={[...data.fyList.map((f) => ({ value: f, label: f })), { value: "all", label: "All years" }]}
          value={fy || "all"}
          onChange={setFy}
          className="no-scrollbar max-w-full overflow-x-auto"
        />
        <div className="flex items-center gap-2">
          <ScopeSelect />
          <Button variant="outline" onClick={download} disabled={rows.length === 0}>
            <Download /> CSV for your CA
          </Button>
        </div>
      </div>

      {totals && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Term
            label="Short-term"
            hint="Sold within a year of buying (listed shares, equity ETFs and funds; two years for most others). Taxed as short-term capital gains."
            t={totals.shortTerm}
            base={base}
          />
          <Term label="Long-term" hint="Held longer than that. Taxed as long-term capital gains, with a yearly exemption on listed shares and equity funds." t={totals.longTerm} base={base} />
          {totals.unknownTerm.count > 0 && (
            <Term
              label="Holding period unknown"
              hint="Sold from shares your holdings statement says you already had before your files begin. The purchase day isn't known, so short or long can't be told. Most likely long-term."
              t={totals.unknownTerm}
              base={base}
              warn
            />
          )}
        </div>
      )}

      {unmatched.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-card p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="font-semibold">
              {unmatched.length} sale{unmatched.length === 1 ? "" : "s"} worth {money(unmatchedValue, base)} {unmatched.length === 1 ? "has" : "have"} no purchase on record
            </p>
            <p className="mt-1 text-muted-foreground">
              These shares were bought before your files start, so their gain can't be worked out and isn't included above. Add an older statement (or the
              broker's holdings as of then) to complete it: {[...new Set(unmatched.map((u) => displayName(u)))].slice(0, 6).join(", ")}
              {new Set(unmatched.map((u) => u.symbol)).size > 6 ? "…" : ""}.
            </p>
          </div>
        </div>
      )}

      <Panel title={`Sales${rows.length ? ` (${rows.length})` : ""}`}>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sales with a purchase on record in this year.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  <th className="px-5 py-2.5">What</th>
                  <th className="px-3 py-2.5">Bought</th>
                  <th className="px-3 py-2.5">Sold</th>
                  <th className="px-3 py-2.5 text-right">Units</th>
                  <th className="px-3 py-2.5 text-right">Sold for</th>
                  <th className="px-3 py-2.5 text-right">Cost</th>
                  <th className="px-3 py-2.5 text-right">Gain</th>
                  <th className="px-5 py-2.5">Term</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const g = Number(r.gainBase ?? r.gain);
                  return (
                    <tr key={`${r.securityId}-${r.sellDate}-${i}`} className="border-b border-border/60 last:border-0">
                      <td className="max-w-[240px] px-5 py-2.5">
                        <span className="block truncate font-semibold">{displayName(r)}</span>
                        {r.currency !== base && <span className="text-xs text-muted-foreground">{r.currency} · converted at each day's rate</span>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{r.buyDateKnown ? dateShort(r.buyDate) : "before files"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{dateShort(r.sellDate)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{qty(r.quantity)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{money(r.proceedsBase ?? r.proceeds, base)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{money(r.costBase ?? r.cost, base)}</td>
                      <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", g >= 0 ? "text-gain" : "text-loss")}>{signedMoney(g, base, false)}</td>
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                            !r.buyDateKnown ? "bg-warning/15 text-warning" : r.term === "long" ? "bg-gain/15 text-gain" : "bg-raised text-muted-foreground",
                          )}
                        >
                          {!r.buyDateKnown ? "Unknown" : r.term === "long" ? "Long" : "Short"}
                        </span>
                        {r.buyDateKnown && <span className="ml-2 text-xs text-muted-foreground">{r.holdingDays} days</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-xs text-muted-foreground">
        {data.disclaimer}
        {data.fxApprox && " Some foreign trades used today's exchange rate until their day's rate is fetched."}
      </p>
    </div>
  );
}

function Term({ label, hint, t, base, warn }: { label: string; hint: string; t: TermTotals; base: string; warn?: boolean }) {
  const g = Number(t.gain);
  return (
    <div className={cn("rounded-2xl border bg-card px-5 py-4", warn && "border-warning/40")}>
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label} <Hint>{hint}</Hint>
      </p>
      <p className={cn("mt-1.5 text-2xl font-semibold tracking-tight", g > 0 && "text-gain", g < 0 && "text-loss")} title={money(t.gain, base)}>
        {signedMoney(t.gain, base)}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t.count} sale{t.count === 1 ? "" : "s"} · sold for {money(t.proceeds, base)}
      </p>
    </div>
  );
}
