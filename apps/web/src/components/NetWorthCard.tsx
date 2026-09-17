import type { HoldingsResponse } from "../lib/api.js";
import { Card } from "./ui.js";
import { money, num, pct, signClass, signGlyph } from "../lib/format.js";

const HOLDINGS_COLOR = "var(--color-chart-1)";
const CASH_COLOR = "var(--color-chart-4)";

/** Headline: net worth (holdings + cash when tracked) with total return and a composition bar. */
export function NetWorthCard({ data }: { data: HoldingsResponse }) {
  const s = data.summary;
  const priced = s.pricedPositions > 0;
  const label = data.cashTracked ? "Net worth" : priced ? "Portfolio value" : "Invested";
  const headline = data.cashTracked ? s.netWorth : priced ? s.currentValue : s.invested;

  const invested = num(s.invested) ?? 0;
  const totalReturn = num(s.netPnl) ?? 0; // unrealised + realised + dividends
  const retPct = invested > 0 ? totalReturn / invested : null;

  const holdings = num(s.currentValue) ?? 0;
  const cash = num(s.cash) ?? 0;
  const total = holdings + cash;
  const holdingsW = total > 0 ? (holdings / total) * 100 : 0;
  const cashW = total > 0 ? (cash / total) * 100 : 0;

  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="font-mono tabular text-3xl">{money(headline)}</div>
        {priced && retPct !== null && (
          <div className={`font-mono tabular text-sm ${signClass(totalReturn)}`}>
            {signGlyph(totalReturn)}
            {money(Math.abs(totalReturn))} ({pct(Math.abs(retPct))})
          </div>
        )}
      </div>

      {data.cashTracked && priced && (
        <>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-muted">
            <div style={{ width: `${holdingsW}%`, backgroundColor: HOLDINGS_COLOR }} />
            <div style={{ width: `${cashW}%`, backgroundColor: CASH_COLOR }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: HOLDINGS_COLOR }} /> Holdings {money(s.currentValue)}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: CASH_COLOR }} /> Cash {money(s.cash)}
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
