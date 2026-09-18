import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { HoldingsResponse } from "../lib/api.js";
import { Card, Badge, cx } from "./ui.js";
import { money, pct, assetClassLabel } from "../lib/format.js";

const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-muted-foreground)",
];

type Dim = "byAssetClass" | "bySector" | "bySubSector" | "byCurrency";
const TABS: { key: Dim; label: string }[] = [
  { key: "byAssetClass", label: "Asset class" },
  { key: "bySector", label: "Sector" },
  { key: "bySubSector", label: "Sub-sector" },
  { key: "byCurrency", label: "Currency" },
];

export function AllocationCard({ allocation, initialDim = "byAssetClass" }: { allocation: HoldingsResponse["allocation"]; initialDim?: Dim }) {
  const [dim, setDim] = useState<Dim>(initialDim);
  const slices = allocation[dim];
  const mapped = slices.map((a) => ({
    name: dim === "byAssetClass" ? assetClassLabel(a.key) : a.key,
    value: Number(a.value),
    weight: Number(a.weight),
  }));
  // Keep the chart legible: top 8, roll the rest into "Other".
  const TOP = 8;
  const data =
    mapped.length > TOP
      ? [...mapped.slice(0, TOP), mapped.slice(TOP).reduce((acc, s) => ({ name: "Other", value: acc.value + s.value, weight: acc.weight + s.weight }), { name: "Other", value: 0, weight: 0 })]
      : mapped;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Allocation <Badge tone="muted">{allocation.basis === "current_value" ? "by value" : "by invested"}</Badge>
        </h3>
        <div className="flex rounded-md border p-0.5 text-xs">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setDim(t.key)}
              className={cx("rounded px-2 py-1", dim === t.key ? "bg-accent font-medium text-foreground" : "text-muted-foreground")}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No allocation to show.</p>
      ) : (
        <div className="flex items-center gap-4 max-sm:flex-col">
          <div className="h-48 w-48 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" innerRadius={45} outerRadius={80} paddingAngle={2}>
                  {data.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="var(--color-card)" />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => money(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex-1 space-y-1.5 text-sm">
            {data.map((dItem, i) => (
              <li key={dItem.name} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                  {dItem.name}
                </span>
                <span className="font-mono tabular text-muted-foreground">{pct(dItem.weight)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
