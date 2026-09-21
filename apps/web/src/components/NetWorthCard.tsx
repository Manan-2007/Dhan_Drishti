import type { HoldingsResponse } from "../lib/api.js";
import { Card } from "./ui.js";
import { money, num, pct, signClass, signGlyph } from "../lib/format.js";

const HOLDINGS_COLOR = "var(--color-chart-1)";
const CASH_COLOR = "var(--color-chart-4)";
const MANUAL_COLOR = "var(--color-chart-3)";

/** Headline: net worth (holdings + cash + manual assets) with total return and a composition bar. */
export function NetWorthCard({ data }: { data: HoldingsResponse }) {
  const s = data.summary;
  const priced = s.pricedPositions > 0;

  const holdings = priced ? num(s.currentValue) ?? 0 : num(s.invested) ?? 0;
  const cash = data.cashTracked ? num(s.cash) ?? 0 : 0;
  const manual = num(s.manualAssets) ?? 0;
  const total = holdings + cash + manual;
  const hasExtras = cash > 0 || manual > 0;
  const label = hasExtras ? "Net worth" : priced ? "Portfolio value" : "Invested";

  const invested = num(s.invested) ?? 0;
  const totalReturn = num(s.netPnl) ?? 0; // unrealised + realised + dividends (holdings only)
  const retPct = invested > 0 ? totalReturn / invested : null;

  const parts = [
    { label: "Holdings", value: holdings, color: HOLDINGS_COLOR },
    { label: "Cash", value: cash, color: CASH_COLOR },
    { label: "Manual assets", value: manual, color: MANUAL_COLOR },
  ].filter((p) => p.value !== 0);
  // The stacked bar shows only positive components, sized against their own sum so it never
  // overflows. A negative component (e.g. an F&O margin debit) still appears in the legend with
  // its real sign, explaining why net worth can sit below the sum of the positive parts.
  const positiveTotal = parts.reduce((acc, p) => (p.value > 0 ? acc + p.value : acc), 0);
  const seg = (v: number) => (positiveTotal > 0 ? (v / positiveTotal) * 100 : 0);

  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="font-mono tabular text-3xl">{money(total)}</div>
        {priced && retPct !== null && (
          <div className={`font-mono tabular text-sm ${signClass(totalReturn)}`}>
            {signGlyph(totalReturn)}
            {money(Math.abs(totalReturn))} ({pct(Math.abs(retPct))})
          </div>
        )}
      </div>

      {hasExtras && parts.length > 1 && positiveTotal > 0 && (
        <>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-muted">
            {parts.filter((p) => p.value > 0).map((p) => (
              <div key={p.label} style={{ width: `${seg(p.value)}%`, backgroundColor: p.color }} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {parts.map((p) => (
              <span key={p.label} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: p.color, opacity: p.value < 0 ? 0.4 : 1 }} /> {p.label} {money(p.value)}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
