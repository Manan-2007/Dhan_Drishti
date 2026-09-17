import type { HoldingsResponse } from "../lib/api.js";
import { Card, Badge } from "./ui.js";
import { compactMoney, num, pct, signClass } from "../lib/format.js";

/** Horizontal bar ranking of the largest positions by base-currency value. */
export function TopHoldingsCard({ data }: { data: HoldingsResponse }) {
  const rows = data.holdings
    .filter((h) => Number(h.netQty) !== 0)
    .map((h) => ({
      symbol: h.security.symbol,
      value: num(h.baseCurrentValue) ?? num(h.baseInvested) ?? 0,
      pctChange: h.unrealisedPct,
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.value));
  const priced = data.summary.pricedPositions > 0;

  return (
    <Card>
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        Top holdings <Badge tone="muted">by value</Badge>
      </h3>
      <ul className="space-y-3">
        {rows.map((r, i) => (
          <li key={r.symbol}>
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-medium">{r.symbol}</span>
              <span className="flex shrink-0 items-center gap-2 font-mono tabular">
                {priced && r.pctChange !== null && <span className={`text-xs ${signClass(r.pctChange)}`}>{pct(r.pctChange)}</span>}
                <span className="text-muted-foreground">{compactMoney(r.value)}</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${(r.value / max) * 100}%`, backgroundColor: `var(--color-chart-${(i % 5) + 1})` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
