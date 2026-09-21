import { Link, useParams } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useFilter, useSecurityDetail } from "../lib/hooks.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card, EmptyState, Spinner, Badge } from "../components/ui.js";
import { money, compactMoney, qty as fmtQty, pct, signClass, signGlyph, dateShort, assetClassLabel } from "../lib/format.js";

function Stat({ label, value, valueClass, hint }: { label: string; value: string; valueClass?: string; hint?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono tabular text-lg ${valueClass ?? ""}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

const TX_TONE: Record<string, "success" | "danger" | "muted"> = { buy: "success", sell: "danger" };

export function SecurityDetail() {
  const { id } = useParams();
  const { portfolioId } = useFilter();
  const { data, isLoading, isError } = useSecurityDetail(id, portfolioId);

  if (isLoading) return <Spinner />;
  if (isError || !data) {
    return (
      <>
        <PageHeader title="Security" showFilter={false} />
        <EmptyState title="Not found">
          This security isn't in your ledger{portfolioId ? " for the selected portfolio" : ""}.{" "}
          <Link to="/holdings" className="underline">Back to holdings</Link>
        </EmptyState>
      </>
    );
  }

  const s = data.security;
  const p = data.position;
  const cur = s.currency;
  const priced = p?.currentValue != null;
  const chart = data.history.map((h) => ({ date: h.date, close: h.close }));

  const netPnl = p ? Number(p.netPnl ?? 0) : 0;
  const portNet = Number(data.portfolioNetPnl);
  const contribution = portNet !== 0 ? netPnl / portNet : null;

  return (
    <>
      <div className="mb-2 text-sm">
        <Link to="/holdings" className="text-muted-foreground underline">← Holdings</Link>
      </div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl">{s.symbol}</h1>
          <p className="text-sm text-muted-foreground">{s.name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Badge tone="muted">{assetClassLabel(s.assetClass)}</Badge>
            {s.sector && <Badge tone="muted">{s.sector}</Badge>}
            {s.exchange && <span className="text-muted-foreground">{s.exchange}</span>}
            {cur !== "INR" && <span className="text-muted-foreground">{cur}</span>}
            {s.isin && <span className="text-muted-foreground">{s.isin}</span>}
          </div>
        </div>
        {p?.quote && (
          <div className="text-right">
            <div className="font-mono tabular text-2xl">{money(p.quote.price, cur)}</div>
            <div className="text-xs text-muted-foreground">
              {p.quote.estimated ? "estimated · " : ""}as of {dateShort(p.quote.asOf)}
            </div>
          </div>
        )}
      </div>

      {p && (
        <Card>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label={Number(p.netQty) < 0 ? "Net qty (short)" : "Net qty"} value={fmtQty(p.netQty)} />
            <Stat label="Avg cost" value={p.avgCost ? money(p.avgCost, cur) : "—"} />
            <Stat label="Invested" value={money(p.invested, cur)} />
            <Stat label="Current value" value={priced ? money(p.currentValue, cur) : "—"} hint={priced ? undefined : "no price"} />
            <Stat label="Unrealised P&L" value={priced ? money(p.unrealisedPnl, cur) : "—"} valueClass={signClass(p.unrealisedPnl)} hint={p.unrealisedPct ? pct(p.unrealisedPct) : undefined} />
            <Stat label="Realised P&L" value={money(p.realisedPnl, cur)} valueClass={signClass(p.realisedPnl)} />
            <Stat label="Dividends" value={money(p.dividends, cur)} />
            <Stat
              label="Net P&L"
              value={priced || Number(p.realisedPnl) !== 0 ? money(p.netPnl, cur) : "—"}
              valueClass={signClass(p.netPnl)}
              hint={contribution !== null && netPnl !== 0 ? `${signGlyph(contribution)}${pct(Math.abs(contribution))} of portfolio` : undefined}
            />
          </div>
        </Card>
      )}

      <Card className="mt-4">
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">Price history</h3>
        {chart.length >= 2 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={dateShort} tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} minTickGap={40} />
                <YAxis tickFormatter={(v) => compactMoney(v, cur)} tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} width={56} domain={["auto", "auto"]} />
                <Tooltip formatter={(v: number) => money(v, cur)} labelFormatter={(l) => dateShort(String(l))} />
                <Line type="monotone" dataKey="close" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No price history available for this security (mutual funds and some instruments aren't charted).</p>
        )}
      </Card>

      <Card className="mt-4 overflow-x-auto p-0">
        <div className="px-4 pt-4">
          <h3 className="text-sm font-medium text-muted-foreground">Transactions ({data.transactions.length})</h3>
        </div>
        <table className="mt-2 w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 text-right font-medium">Qty</th>
              <th className="px-4 py-3 text-right font-medium">Price</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.transactions.map((t) => (
              <tr key={t.id} className="border-b last:border-0 hover:bg-accent/50">
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{dateShort(t.tradeDate)}</td>
                <td className="px-4 py-3">
                  <Badge tone={TX_TONE[t.type] ?? "muted"}>{t.type}</Badge>
                </td>
                <td className="px-4 py-3 text-right font-mono tabular">{Number(t.quantity) ? fmtQty(t.quantity) : "—"}</td>
                <td className="px-4 py-3 text-right font-mono tabular">{t.type === "split" ? `×${Number(t.price)}` : Number(t.price) ? money(t.price, t.currency) : "—"}</td>
                <td className="px-4 py-3 text-right font-mono tabular">{money(t.grossAmount, t.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
