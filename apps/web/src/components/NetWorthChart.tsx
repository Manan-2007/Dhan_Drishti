import { useState } from "react";
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useNetWorth, type NetWorthRange } from "../lib/hooks.js";
import { Card } from "./ui.js";
import { compactMoney, money, pct, dateShort, signClass, signGlyph } from "../lib/format.js";

const RANGES: { id: NetWorthRange; label: string }[] = [
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "6m", label: "6M" },
  { id: "1y", label: "1Y" },
  { id: "max", label: "Max" },
];

const NET_COLOR = "var(--color-chart-1)";
const INVESTED_COLOR = "var(--color-chart-4)";

interface TipProps {
  active?: boolean;
  payload?: { payload: { date: string; value: number; invested: number } }[];
}
function ChartTooltip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-medium">{dateShort(p.date)}</div>
      <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: NET_COLOR }} /> Net worth {money(p.value)}</div>
      <div className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: INVESTED_COLOR }} /> Invested {money(p.invested)}</div>
    </div>
  );
}

/** Net-worth over time (from daily snapshots) with a range toggle and the change over the window. */
export function NetWorthChart({ portfolioId }: { portfolioId: string | null }) {
  const [range, setRange] = useState<NetWorthRange>("max");
  const { data, isLoading } = useNetWorth(portfolioId, range);
  const series = data?.series ?? [];
  const points = series.map((p) => ({ date: p.date, value: Number(p.netWorth), invested: Number(p.invested) }));

  const first = points[0];
  const last = points[points.length - 1];
  const delta = first && last ? last.value - first.value : 0;
  const deltaPct = first && first.value > 0 ? delta / first.value : null;
  const rangeLabel = RANGES.find((r) => r.id === range)?.label ?? "Max";

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Net worth over time</div>
          {points.length >= 2 ? (
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono tabular text-2xl">{money(last!.value)}</span>
              <span className={`font-mono tabular text-sm ${signClass(delta)}`}>
                {signGlyph(delta)}
                {money(Math.abs(delta))}
                {deltaPct !== null && ` (${pct(Math.abs(deltaPct))})`}
              </span>
            </div>
          ) : (
            <div className="mt-1 font-mono tabular text-2xl">{last ? money(last.value) : "—"}</div>
          )}
          {points.length >= 2 && <div className="text-xs text-muted-foreground">change since {dateShort(first!.date)}</div>}
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`rounded-md px-2 py-1 text-xs ${range === r.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 h-56">
        {isLoading ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading…</div>
        ) : points.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={NET_COLOR} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={NET_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={dateShort} tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} minTickGap={40} />
              <YAxis tickFormatter={(v) => compactMoney(v)} tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} width={52} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="value" stroke={NET_COLOR} strokeWidth={2} fill="url(#nwFill)" />
              <Line type="monotone" dataKey="invested" stroke={INVESTED_COLOR} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">
            Your net-worth history builds here as you use Dhan Drishti — a point is recorded each day
            (and on every price refresh). Check back tomorrow to see the {rangeLabel === "Max" ? "" : `${rangeLabel} `}trend.
          </div>
        )}
      </div>
      {points.length >= 2 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: NET_COLOR }} /> Net worth</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: INVESTED_COLOR }} /> Invested (cost)</span>
        </div>
      )}
    </Card>
  );
}
