import { useFilter, useDividends } from "../lib/hooks.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card, EmptyState, Spinner, Badge } from "../components/ui.js";
import { compactMoney, money, dateShort } from "../lib/format.js";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono tabular text-xl text-success">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function Dividends() {
  const { portfolioId } = useFilter();
  const { data, isLoading } = useDividends(portfolioId);

  if (isLoading) return <Spinner />;
  if (!data || data.count === 0) {
    return (
      <>
        <PageHeader title="Dividends" subtitle="Income received from your holdings" />
        <EmptyState title="No dividend income yet">
          Dividend and interest payouts appear here once they're in your ledger — imported from a
          broker statement or added directly. Only real payouts are shown, never projections.
        </EmptyState>
      </>
    );
  }

  const latestFY = data.byFY[0];
  return (
    <>
      <PageHeader title="Dividends" subtitle={`${data.count} payout${data.count === 1 ? "" : "s"} received`} />

      {!data.fxComplete && (
        <Card className="mb-4 border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          Some payouts are in {data.unconvertibleCurrencies.join(", ")} with no exchange rate yet, so they're
          excluded from the {data.baseCurrency} totals. Refresh prices or set a rate in Settings.
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total received" value={compactMoney(data.total)} hint={money(data.total)} />
        {latestFY && <Stat label={`Latest FY (${latestFY.key.replace("FY ", "")})`} value={compactMoney(latestFY.amount)} hint={money(latestFY.amount)} />}
        <Stat label="Paying securities" value={String(data.bySecurity.length)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">By financial year</h3>
          <ul className="space-y-2 text-sm">
            {data.byFY.map((f) => (
              <li key={f.key} className="flex items-center justify-between border-b pb-2 last:border-0">
                <span>{f.key}</span>
                <span className="font-mono tabular text-success">{money(f.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">Top payers</h3>
          <ul className="space-y-2 text-sm">
            {data.bySecurity.slice(0, 8).map((s) => (
              <li key={s.symbol} className="flex items-center justify-between border-b pb-2 last:border-0">
                <span className="min-w-0 truncate" title={s.name}>
                  <span className="font-medium">{s.symbol}</span> <span className="text-muted-foreground">{s.name}</span>
                </span>
                <span className="ml-3 shrink-0 font-mono tabular text-success">{money(s.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-4 overflow-x-auto p-0">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Security</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.events.map((e) => (
              <tr key={e.id} className="border-b last:border-0 hover:bg-accent/50">
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{dateShort(e.tradeDate)}</td>
                <td className="px-4 py-3">
                  {e.security ? (
                    <span>
                      <span className="font-medium">{e.security.symbol}</span>{" "}
                      <span className="text-muted-foreground">{e.security.name}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={e.type === "dividend" ? "success" : "muted"}>{e.type}</Badge>
                </td>
                <td className="px-4 py-3 text-right font-mono tabular text-success">{money(e.amount, e.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-6 text-center text-xs text-muted-foreground">Every payout traces to a real ledger entry.</p>
    </>
  );
}
