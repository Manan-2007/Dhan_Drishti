import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { Loader2, Wand2 } from "lucide-react";
import { Segmented } from "@/components/kit/Segmented";
import { Empty } from "@/components/kit/Empty";
import { ScopeSelect } from "@/components/shell/ScopeSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useFilter, useRebalance } from "@/lib/hooks";
import { api, type RebalanceDimension, type RebalanceResponse } from "@/lib/api";
import { assetClassLabel, compactMoney, money } from "@/lib/format";
import { assetColor } from "@/lib/assetColors";
import { cn } from "@/lib/utils";

const DIMS: { value: RebalanceDimension; label: string }[] = [
  { value: "asset_class", label: "By kind" },
  { value: "sector", label: "By sector" },
];

const pctOf = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n / 100 : 0;
};

/** Your own target mix against today's, and how much to add or trim to get there. Not advice. */
export function Rebalance() {
  const { portfolioId } = useFilter();
  const [dimension, setDimension] = useState<RebalanceDimension>("asset_class");
  const { data, isLoading } = useRebalance(portfolioId, dimension);
  const qc = useQueryClient();
  const reduceMotion = useReducedMotion();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!data) return;
    const seed: Record<string, string> = {};
    for (const r of data.rows) if (r.targetWeight) seed[r.key] = String(Math.round(Number(r.targetWeight) * 1000) / 10);
    setDraft(seed);
    setDirty(false);
  }, [data]);

  const save = useMutation({
    mutationFn: (targets: { key: string; weight: string }[]) => api.put<RebalanceResponse>("/api/rebalance", { portfolioId: portfolioId ?? undefined, dimension, targets }),
    onSuccess: () => {
      setDirty(false);
      toast.success("Targets saved");
      void qc.invalidateQueries({ queryKey: ["rebalance", portfolioId, dimension] });
    },
    onError: () => toast.error("Couldn't save the targets"),
  });

  const total = Number(data?.totalValue ?? 0);
  const sum = useMemo(() => Object.values(draft).reduce((a, v) => a + pctOf(v), 0), [draft]);
  const over = sum > 1.0001;

  if (isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (!data || data.rows.length === 0) {
    return <Empty title="Nothing to balance yet" body="Once you have holdings, set the mix you want — say 60% shares, 30% funds, 10% gold — and see how far each part is from it." />;
  }

  const setKey = (key: string, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };
  const useCurrent = () => {
    const next: Record<string, string> = {};
    for (const r of data.rows) next[r.key] = String(Math.round(Number(r.currentWeight) * 1000) / 10);
    setDraft(next);
    setDirty(true);
  };
  const onSave = () => save.mutate(data.rows.map((r) => ({ key: r.key, weight: String(pctOf(draft[r.key] ?? "")) })).filter((t) => Number(t.weight) > 0));
  const label = (k: string) => (dimension === "asset_class" ? assetClassLabel(k) : k);

  return (
    <div className="space-y-5 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented ariaLabel="Group by" options={DIMS} value={dimension} onChange={setDimension} />
        <div className="flex items-center gap-2">
          <ScopeSelect />
          <Button variant="outline" onClick={useCurrent}>
            <Wand2 /> Start from today's mix
          </Button>
        </div>
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Type the share you want for each part. The bar shows where you are now; the white mark is your target. Worth {compactMoney(total, data.baseCurrency)}
        {data.basis === "invested" ? " (by money put in, as some prices are missing)" : ""}.
      </p>

      <ul className="space-y-2">
        {data.rows.map((r, i) => {
          const cur = Number(r.currentWeight);
          const target = pctOf(draft[r.key] ?? "");
          const gap = target ? target - cur : null;
          const move = gap !== null ? gap * total : null;
          const onTarget = gap !== null && Math.abs(gap) < 0.005;
          return (
            <li key={r.key} className="rounded-2xl border bg-card px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="flex min-w-40 flex-1 items-center gap-2.5">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: assetColor(r.key, i) }} />
                  <span className="font-semibold">{label(r.key)}</span>
                </span>
                <span className="w-36 text-sm tabular-nums">
                  <b>{(cur * 100).toFixed(1)}%</b> <span className="text-muted-foreground">{compactMoney(r.currentValue, data.baseCurrency)}</span>
                </span>
                <label className="flex items-center gap-1.5 text-sm">
                  <span className="text-muted-foreground">target</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.5"
                    placeholder="—"
                    value={draft[r.key] ?? ""}
                    onChange={(e) => setKey(r.key, e.target.value)}
                    className="h-9 w-20 rounded-full text-right tabular-nums"
                    aria-label={`Target for ${label(r.key)}`}
                  />
                  <span className="text-muted-foreground">%</span>
                </label>
                <span className="w-36 text-right text-sm">
                  {move === null ? (
                    <span className="text-muted-foreground">no target</span>
                  ) : onTarget ? (
                    <span className="rounded-full bg-raised px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">On target</span>
                  ) : (
                    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", move > 0 ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss")} title={money(Math.abs(move), data.baseCurrency)}>
                      {move > 0 ? "Add" : "Trim"} {compactMoney(Math.abs(move), data.baseCurrency)}
                    </span>
                  )}
                </span>
              </div>
              <div className="relative mt-3 h-2 rounded-full bg-raised">
                <motion.div
                  initial={reduceMotion ? false : { width: 0 }}
                  animate={{ width: `${Math.min(cur, 1) * 100}%` }}
                  transition={{ delay: 0.05 * i, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: assetColor(r.key, i) }}
                />
                {target > 0 && (
                  <motion.span
                    layout
                    className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
                    style={{ left: `${Math.min(target, 1) * 100}%` }}
                    aria-hidden
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">Your targets, your call — this only does the arithmetic. It isn't investment advice.</p>

      <AnimatePresence>
        {(dirty || data.hasTargets) && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
            className="fixed inset-x-0 bottom-5 z-30 px-4"
          >
            <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 rounded-full border bg-popover py-2.5 pr-2.5 pl-6">
              <p className={cn("text-sm tabular-nums", over ? "text-loss" : Math.abs(sum - 1) < 0.001 ? "text-gain" : "text-muted-foreground")}>
                Targets add up to <b>{(sum * 100).toFixed(1)}%</b>
                {over ? " — over 100%" : sum < 0.999 && sum > 0 ? " — the rest is untargeted" : ""}
              </p>
              <div className="flex items-center gap-2">
                {data.hasTargets && (
                  <Button variant="ghost" size="sm" onClick={() => save.mutate([])} disabled={save.isPending}>
                    Clear
                  </Button>
                )}
                <Button onClick={onSave} disabled={!dirty || over || save.isPending}>
                  {save.isPending && <Loader2 className="animate-spin" />} Save targets
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
