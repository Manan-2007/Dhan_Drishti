import { useMemo, useState } from "react";
import { useFilter, useCapitalGains } from "../lib/hooks.js";
import type { CapitalGainRow, TermTotals } from "../lib/api.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card, EmptyState, Spinner, Button, Badge, Select } from "../components/ui.js";
import { money, compactMoney, signClass, dateShort, financialYear } from "../lib/format.js";

function TermCard({ label, term, color }: { label: string; term: TermTotals; color: string }) {
  const gain = Number(term.gain);
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} /> {label}
      </div>
      <div className={`mt-1 font-mono tabular text-2xl ${signClass(gain)}`}>{money(term.gain)}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {term.count} sale{term.count === 1 ? "" : "s"} · {compactMoney(term.proceeds)} proceeds · {compactMoney(term.cost)} cost
      </div>
    </Card>
  );
}

function toCsv(rows: CapitalGainRow[]): string {
  const head = ["Security", "Asset class", "Buy date", "Sell date", "Quantity", "Proceeds", "Cost", "Gain", "Term", "Holding (days)", "Currency"];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = rows.map((r) =>
    [r.symbol, r.assetClass, r.buyDate, r.sellDate, r.quantity, r.proceeds, r.cost, r.gain, r.term === "long" ? "Long-term" : "Short-term", String(r.holdingDays), r.currency]
      .map(esc)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

export function Reports() {
  const { portfolioId } = useFilter();
  const { data, isLoading } = useCapitalGains(portfolioId);
  const [fy, setFy] = useState("all");

  const rows = useMemo(() => (data ? (fy === "all" ? data.rows : data.rows.filter((r) => financialYear(r.sellDate) === fy)) : []), [data, fy]);
  const totals = useMemo(() => {
    if (!data) return null;
    if (fy === "all") return data.totals;
    return data.byFY.find((f) => f.key === fy) ?? { shortTerm: { gain: "0", proceeds: "0", cost: "0", count: 0 }, longTerm: { gain: "0", proceeds: "0", cost: "0", count: 0 } };
  }, [data, fy]);

  if (isLoading) return <Spinner />;

  function download() {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `capital-gains-${fy === "all" ? "all" : fy.replace(/\s+/g, "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader title="Capital gains" subtitle="FIFO short- & long-term gains for your tax return" />

      {!data || data.rows.length === 0 ? (
        <EmptyState title="No capital gains yet">
          Realised capital gains appear here once you have sell transactions. Gains are matched
          first-in-first-out (the method Indian ITR uses) and split into short- and long-term. F&O is
          excluded — it's business income, not capital gains.
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="w-48">
              <Select value={fy} onChange={(e) => setFy(e.target.value)}>
                <option value="all">All financial years</option>
                {data.fyList.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="secondary" className="h-10" onClick={download}>
              ⤓ Download CSV
            </Button>
          </div>

          {totals && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TermCard label="Short-term (STCG)" term={totals.shortTerm} color="var(--color-chart-4)" />
              <TermCard label="Long-term (LTCG)" term={totals.longTerm} color="var(--color-chart-1)" />
            </div>
          )}

          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Security</th>
                  <th className="px-4 py-3 font-medium">Bought</th>
                  <th className="px-4 py-3 font-medium">Sold</th>
                  <th className="px-4 py-3 text-right font-medium">Qty</th>
                  <th className="px-4 py-3 text-right font-medium">Proceeds</th>
                  <th className="px-4 py-3 text-right font-medium">Cost</th>
                  <th className="px-4 py-3 text-right font-medium">Gain</th>
                  <th className="px-4 py-3 font-medium">Term</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-accent/50">
                    <td className="px-4 py-3">
                      <span className="font-medium">{r.symbol}</span>{" "}
                      <span className="text-muted-foreground">{r.name}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{dateShort(r.buyDate)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{dateShort(r.sellDate)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular">{r.quantity}</td>
                    <td className="px-4 py-3 text-right font-mono tabular">{money(r.proceeds, r.currency)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular">{money(r.cost, r.currency)}</td>
                    <td className={`px-4 py-3 text-right font-mono tabular ${signClass(r.gain)}`}>{money(r.gain, r.currency)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={r.term === "long" ? "success" : "muted"}>{r.term === "long" ? "Long" : "Short"}</Badge>
                      <span className="ml-2 text-xs text-muted-foreground">{r.holdingDays}d</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {data.currencyNote && <p className="mt-3 text-xs text-warning">{data.currencyNote}</p>}
          <p className="mt-3 text-xs text-muted-foreground">{data.disclaimer}</p>
        </>
      )}
    </>
  );
}
