import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { useFilter, usePerformance, useHoldings } from "../lib/hooks.js";
import { PageHeader } from "../components/PageHeader.js";
import { AllocationCard } from "../components/AllocationCard.js";
import { BenchmarkCard } from "../components/BenchmarkCard.js";
import { FxImpactCard } from "../components/FxImpactCard.js";
import { TwrCard } from "../components/TwrCard.js";
import { Card, EmptyState, Spinner } from "../components/ui.js";
import { compactMoney, money, signClass, pct } from "../lib/format.js";

const SEGMENT_LABELS: Record<string, string> = { equity: "Equity", mf: "Mutual Fund", fno: "F&O", commodity: "Commodity", other: "Other" };

function Stat({ label, value, valueClass, hint }: { label: string; value: string; valueClass?: string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono tabular text-xl ${valueClass ?? ""}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function Analytics() {
  const { portfolioId } = useFilter();
  const { data, isLoading } = usePerformance(portfolioId);
  const { data: holdings } = useHoldings(portfolioId);

  if (isLoading) return <Spinner />;
  if (!data) return <EmptyState title="No data" />;

  const s = data.summary;
  const fyData = data.byFY.map((f) => ({ name: f.key.replace("FY ", ""), realised: Number(f.realised), dividends: Number(f.dividends) }));
  const hasRealised = data.byFY.length > 0 || Number(s.realisedPnl) !== 0;
  const hasActivity = hasRealised || s.openPositions > 0;

  return (
    <>
      <PageHeader title="Analytics" subtitle="Realised performance & returns" />

      {!hasRealised ? (
        <EmptyState title="No realised performance yet">
          Realised P&L, financial-year breakdowns and XIRR appear once you have sell transactions.
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Realised P&L" value={compactMoney(s.realisedPnl)} valueClass={signClass(s.realisedPnl)} hint={money(s.realisedPnl)} />
            <Stat label="Dividends" value={compactMoney(s.dividends)} hint={money(s.dividends)} />
            <Stat label="Unrealised P&L" value={s.allPriced || Number(s.currentValue) > 0 ? compactMoney(s.unrealisedPnl) : "—"} valueClass={signClass(s.unrealisedPnl)} />
            <Stat
              label="XIRR (money-weighted)"
              value={data.xirrAvailable && data.xirr !== null ? pct(data.xirr) : "—"}
              valueClass={data.xirrAvailable && data.xirr !== null ? signClass(data.xirr) : ""}
              hint={data.xirrAvailable ? "annualized" : "needs prices for open positions"}
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <h3 className="mb-3 text-sm font-medium text-muted-foreground">Realised P&L by financial year</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={fyData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v) => compactMoney(v)} tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} width={70} />
                    <Tooltip formatter={(v: number) => money(v)} cursor={{ fill: "var(--color-accent)" }} />
                    <Bar dataKey="realised" radius={[4, 4, 0, 0]}>
                      {fyData.map((d, i) => (
                        <Cell key={i} fill={d.realised >= 0 ? "var(--color-success)" : "var(--color-destructive)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <h3 className="mb-3 text-sm font-medium text-muted-foreground">Realised P&L by segment</h3>
              <ul className="space-y-2 text-sm">
                {data.bySegment.map((seg) => (
                  <li key={seg.key} className="flex items-center justify-between border-b pb-2 last:border-0">
                    <span>{SEGMENT_LABELS[seg.key] ?? seg.key}</span>
                    <span className={`font-mono tabular ${signClass(seg.realised)}`}>{money(seg.realised)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card className="mt-4">
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">Financial-year detail</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Financial year</th>
                    <th className="py-2 pr-4 text-right font-medium">Realised P&L</th>
                    <th className="py-2 text-right font-medium">Dividends</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.byFY].reverse().map((f) => (
                    <tr key={f.key} className="border-b last:border-0">
                      <td className="py-2 pr-4">{f.key}</td>
                      <td className={`py-2 pr-4 text-right font-mono tabular ${signClass(f.realised)}`}>{money(f.realised)}</td>
                      <td className="py-2 text-right font-mono tabular">{money(f.dividends)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {holdings?.allocation && (
        <div className="mt-4">
          <AllocationCard allocation={holdings.allocation} initialDim="bySector" />
        </div>
      )}
      {hasActivity && <BenchmarkCard />}
      {hasActivity && <TwrCard />}
      {hasActivity && <FxImpactCard />}
    </>
  );
}
