import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { Segmented } from "@/components/kit/Segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useFilter, useHoldings } from "@/lib/hooks";
import { assetColor } from "@/lib/assetColors";
import { assetClassLabel, compactMoney } from "@/lib/format";
import type { AllocationSlice } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Empty } from "@/components/kit/Empty";

type Dim = "asset" | "sector" | "currency" | "region";
const DIMS: { value: Dim; label: string }[] = [
  { value: "asset", label: "Asset class" },
  { value: "sector", label: "Sector" },
  { value: "currency", label: "Currency" },
  { value: "region", label: "Region" },
];

const SECTOR_PALETTE = ["#f0b23e", "#5fb7a6", "#8c8fe0", "#d97757", "#7fa66b", "#c9a27e", "#d77fb3", "#7cc7d9", "#e3c07a", "#9dbf8c", "#b8a9e8", "#a3a3ad"];

export function Allocation() {
  const { portfolioId } = useFilter();
  const { data, isLoading } = useHoldings(portfolioId);
  const [dim, setDim] = useState<Dim>("asset");
  const reduceMotion = useReducedMotion();

  if (isLoading) return <Skeleton className="h-[420px] rounded-2xl" />;
  if (!data || data.holdings.length === 0) return <Empty title="No allocation yet" body="Once your holdings are in, this shows how your money is spread." />;

  const a = data.allocation;
  const slices: AllocationSlice[] = {
    asset: a.byAssetClass,
    sector: a.bySector,
    currency: a.byCurrency,
    region: a.byRegion ?? [],
  }[dim].filter((s) => Number(s.weight) > 0);
  const color = (key: string, i: number) => (dim === "asset" ? assetColor(key, i) : (SECTOR_PALETTE[i % SECTOR_PALETTE.length] ?? "#6f6f7a"));
  const label = (key: string) => (dim === "asset" ? assetClassLabel(key) : key);
  const d = data.diversification;

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <section className="rounded-2xl border bg-card p-6 lg:col-span-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">By {a.basis === "current_value" ? "current value" : "amount invested (some prices missing)"}</p>
          <Segmented ariaLabel="Group allocation by" options={DIMS} value={dim} onChange={setDim} />
        </div>
        <ul className="mt-6 space-y-3.5">
          {slices.map((s, i) => {
            const w = Number(s.weight);
            return (
              <li key={s.key} className="grid grid-cols-[minmax(120px,180px)_1fr_auto] items-center gap-4">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color(s.key, i) }} />
                  <span className="truncate">{label(s.key)}</span>
                </span>
                <span className="h-2.5 overflow-hidden rounded-full bg-raised">
                  <motion.span
                    className="block h-full rounded-full"
                    style={{ backgroundColor: color(s.key, i) }}
                    initial={reduceMotion ? false : { width: 0 }}
                    animate={{ width: `${Math.max(w * 100, 0.8)}%` }}
                    transition={{ delay: i * 0.04, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                  />
                </span>
                <span className="w-36 text-right text-sm">
                  <span className="font-semibold">{(w * 100).toFixed(1)}%</span>
                  <span className="ml-2 text-muted-foreground">{compactMoney(s.value, data.baseCurrency)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-5 lg:col-span-4">
        {d?.available && (
          <div className="rounded-2xl border bg-card p-6">
            <p className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Diversification</p>
            <p className="mt-3 flex items-baseline gap-3">
              <span className="font-display text-6xl leading-none">{Math.round(d.score)}</span>
              <span className={cn("text-lg font-semibold", d.grade === "Concentrated" ? "text-loss" : d.grade === "Fair" ? "text-warning" : "text-gain")}>{d.grade}</span>
            </p>
            <dl className="mt-5 space-y-2 text-sm">
              <Row label="Acts like" value={`${d.effectiveHoldings.toFixed(1)} equal holdings`} />
              {d.top1 && <Row label="Largest holding" value={`${d.top1.label} · ${(d.top1.weight * 100).toFixed(1)}%`} />}
              <Row label="Top 5 together" value={`${(d.top5Weight * 100).toFixed(1)}%`} />
              {d.topSector && <Row label="Largest sector" value={`${d.topSector.label} · ${(d.topSector.weight * 100).toFixed(1)}%`} />}
            </dl>
          </div>
        )}
        {d?.flags && d.flags.length > 0 && (
          <div className="rounded-2xl border bg-card p-6">
            <p className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Worth a look</p>
            <ul className="mt-3 space-y-2 text-sm">
              {d.flags.map((f) => (
                <li key={f.message} className="flex gap-2">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", f.severity === "high" ? "bg-loss" : f.severity === "warn" ? "bg-warning" : "bg-muted-foreground")} />
                  {f.message}
                </li>
              ))}
            </ul>
            <Link to="/performance/rebalance" className="mt-4 inline-block text-sm text-primary hover:underline">
              Set targets and rebalance →
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
