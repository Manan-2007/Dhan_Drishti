import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFilter, useRebalance } from "../lib/hooks.js";
import { api, type RebalanceDimension, type RebalanceResponse } from "../lib/api.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card, EmptyState, Spinner, Button, Badge, Input, cx } from "../components/ui.js";
import { compactMoney, money, pct, signClass, assetClassLabel } from "../lib/format.js";

const DIMS: { id: RebalanceDimension; label: string }[] = [
  { id: "asset_class", label: "Asset class" },
  { id: "sector", label: "Sector" },
];

const labelFor = (dimension: RebalanceDimension, key: string): string =>
  dimension === "asset_class" ? assetClassLabel(key) : key;

/** Parse a user-typed percentage ("60", "12.5") into a fraction; blank/invalid → 0. */
function pctToFraction(input: string): number {
  const n = Number(input);
  return Number.isFinite(n) && n > 0 ? n / 100 : 0;
}

export function Rebalance() {
  const { portfolioId } = useFilter();
  const [dimension, setDimension] = useState<RebalanceDimension>("asset_class");
  const { data, isLoading } = useRebalance(portfolioId, dimension);
  const qc = useQueryClient();

  // Draft target percentages keyed by allocation key ("60" = 60%). Seeded from the server.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!data) return;
    const seed: Record<string, string> = {};
    for (const r of data.rows) if (r.targetWeight) seed[r.key] = (Number(r.targetWeight) * 100).toString();
    setDraft(seed);
    setDirty(false);
  }, [data]);

  const save = useMutation({
    mutationFn: (targets: { key: string; weight: string }[]) =>
      api.put<RebalanceResponse>("/api/rebalance", { portfolioId: portfolioId ?? undefined, dimension, targets }),
    onSuccess: () => {
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ["rebalance", portfolioId, dimension] });
    },
  });

  if (isLoading) return <Spinner />;
  if (!data || data.rows.length === 0) {
    return (
      <>
        <PageHeader title="Rebalance" subtitle="Set target weights and see the drift" />
        <EmptyState title="Nothing to rebalance yet">
          Import or add some holdings first. Once you have positions, set a target weight per{" "}
          {dimension === "asset_class" ? "asset class" : "sector"} and Dhan Drishti will show how far each is from target — in
          both percent and rupees.
        </EmptyState>
      </>
    );
  }

  const draftSum = Object.values(draft).reduce((a, v) => a + pctToFraction(v), 0);
  const over = draftSum > 1.0001;
  const setKey = (key: string, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };
  const onSave = () => {
    const targets = data.rows.map((r) => ({ key: r.key, weight: String(pctToFraction(draft[r.key] ?? "")) })).filter((t) => Number(t.weight) > 0);
    save.mutate(targets);
  };
  const onClear = () => {
    setDraft({});
    setDirty(true);
    save.mutate([]);
  };

  const total = Number(data.totalValue);
  return (
    <>
      <PageHeader title="Rebalance" subtitle={`Portfolio worth ${compactMoney(data.totalValue)} · ${data.basis === "current_value" ? "by value" : "by invested"}`} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border p-0.5 text-sm">
          {DIMS.map((dm) => (
            <button
              key={dm.id}
              onClick={() => setDimension(dm.id)}
              className={cx("rounded px-3 py-1.5", dimension === dm.id ? "bg-accent font-medium text-foreground" : "text-muted-foreground")}
            >
              {dm.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={cx("font-mono tabular", over ? "text-destructive" : "text-muted-foreground")}>
            Target total {(draftSum * 100).toFixed(1)}%
          </span>
          {data.hasTargets && (
            <Button variant="ghost" className="h-9 px-3" onClick={onClear} disabled={save.isPending}>
              Clear
            </Button>
          )}
          <Button className="h-9 px-4" onClick={onSave} disabled={!dirty || over || save.isPending}>
            {save.isPending ? "Saving…" : "Save targets"}
          </Button>
        </div>
      </div>

      {over && (
        <Card className="mb-4 border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
          Your targets add up to {(draftSum * 100).toFixed(1)}% — they can't exceed 100%. Trim one before saving.
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">{dimension === "asset_class" ? "Asset class" : "Sector"}</th>
              <th className="px-4 py-3 text-right font-medium">Current</th>
              <th className="px-4 py-3 text-right font-medium">Target %</th>
              <th className="px-4 py-3 text-right font-medium">Drift</th>
              <th className="px-4 py-3 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const driftValue = r.driftValue !== null ? Number(r.driftValue) : null;
              return (
                <tr key={r.key} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{labelFor(dimension, r.key)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono tabular">{pct(r.currentWeight)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{compactMoney(r.currentValue)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="ml-auto flex w-24 items-center gap-1">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={100}
                        step="0.5"
                        placeholder="—"
                        value={draft[r.key] ?? ""}
                        onChange={(e) => setKey(r.key, e.target.value)}
                        className="h-9 text-right font-mono tabular"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.driftWeight !== null ? (
                      <span className={cx("font-mono tabular", signClass(driftValue))}>
                        {driftValue !== null && driftValue > 0 ? "+" : ""}
                        {pct(r.driftWeight)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.action === "trim" && driftValue !== null ? (
                      <Badge tone="danger">Trim {money(Math.abs(driftValue))}</Badge>
                    ) : r.action === "add" && driftValue !== null ? (
                      <Badge tone="success">Add {money(Math.abs(driftValue))}</Badge>
                    ) : r.action === "hold" ? (
                      <Badge tone="muted">On target</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">no target</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Targets are your own choice; current weights and rupee drift come straight from your priced holdings
        {total > 0 ? "" : " (add prices to see rupee amounts)"}. A drift of “Trim ₹X” means you're that far over target.
      </p>
    </>
  );
}
