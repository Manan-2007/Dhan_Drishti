import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useFilter, useHoldings } from "../lib/hooks.js";
import { PageHeader } from "../components/PageHeader.js";
import { RefreshButton } from "../components/RefreshButton.js";
import { Button, Card, EmptyState, Spinner, Badge, Select, Input } from "../components/ui.js";
import { money, qty, pct, signClass, assetClassLabel } from "../lib/format.js";
import type { HoldingRow } from "../lib/api.js";

type SortKey = "security" | "qty" | "avgCost" | "invested" | "current" | "unrealised" | "realised";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right"; hint: string }[] = [
  { key: "security", label: "Security", align: "left", hint: "The symbol you hold, its asset class and sector." },
  { key: "qty", label: "Qty", align: "right", hint: "Units you currently hold. Negative means a short position (you sold before buying)." },
  { key: "avgCost", label: "Avg cost", align: "right", hint: "Average price you paid per unit (or, for a short, the average price you sold at)." },
  { key: "invested", label: "Invested", align: "right", hint: "Capital you've put in for this position. For a short, this is the credit you received instead." },
  { key: "current", label: "Current", align: "right", hint: "What this position is worth right now, using the latest available price." },
  { key: "unrealised", label: "Unrealised", align: "right", hint: "Paper gain/loss on what you still hold — not locked in until you sell (or cover)." },
  { key: "realised", label: "Realised", align: "right", hint: "Actual profit/loss already locked in from selling or covering." },
];

function sortValue(h: HoldingRow, key: SortKey): number | string | null {
  switch (key) {
    case "security":
      return h.security.symbol;
    case "qty":
      return Number(h.netQty);
    case "avgCost":
      return h.avgCost === null ? null : Number(h.avgCost);
    case "invested":
      return Number(h.netQty) < 0 ? Number(h.shortProceeds) : Number(h.invested);
    case "current":
      return h.currentValue === null ? null : Number(h.currentValue);
    case "unrealised":
      return h.unrealisedPnl === null ? null : Number(h.unrealisedPnl);
    case "realised":
      return Number(h.realisedPnl);
  }
}

function sumBase(rows: HoldingRow[], pick: (r: HoldingRow) => string | null): number | null {
  let total = 0;
  let any = false;
  for (const r of rows) {
    const v = pick(r);
    if (v === null) continue;
    total += Number(v);
    any = true;
  }
  return any ? total : null;
}

export function Holdings() {
  const { portfolioId } = useFilter();
  const { data, isLoading } = useHoldings(portfolioId);
  const [assetClass, setAssetClass] = useState("");
  const [sector, setSector] = useState("");
  const [search, setSearch] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const allRows = data?.holdings ?? [];
  const assetClasses = useMemo(() => [...new Set(allRows.map((r) => r.security.assetClass))].sort(), [allRows]);
  const sectors = useMemo(() => [...new Set(allRows.map((r) => r.security.sector ?? "Unclassified"))].sort(), [allRows]);

  const classSectorFiltered = allRows.filter(
    (r) => (!assetClass || r.security.assetClass === assetClass) && (!sector || (r.security.sector ?? "Unclassified") === sector),
  );
  const q = search.trim().toLowerCase();
  const searched = q
    ? classSectorFiltered.filter((r) => r.security.symbol.toLowerCase().includes(q) || r.security.name.toLowerCase().includes(q))
    : classSectorFiltered;
  const open = searched.filter((r) => Number(r.netQty) !== 0);
  const closed = searched.filter((r) => Number(r.netQty) === 0);
  const visible = showClosed ? searched : open;

  const rows = useMemo(() => {
    if (!sortKey) return visible;
    const withIdx = visible.map((h, i) => ({ h, i }));
    withIdx.sort((a, b) => {
      const va = sortValue(a.h, sortKey);
      const vb = sortValue(b.h, sortKey);
      if (va === null && vb === null) return a.i - b.i; // stable
      if (va === null) return 1; // nulls (unpriced) always sort last
      if (vb === null) return -1;
      const cmp = typeof va === "string" || typeof vb === "string" ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return withIdx.map((x) => x.h);
  }, [visible, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir(key === "security" ? "asc" : "desc");
    }
  }

  const baseCurrency = data?.baseCurrency ?? "INR";
  const totals = {
    invested: sumBase(rows, (r) => r.baseInvested),
    current: sumBase(rows, (r) => r.baseCurrentValue),
    unrealised: sumBase(rows, (r) => r.baseUnrealisedPnl),
    realised: sumBase(rows, (r) => r.baseRealisedPnl),
  };
  const totalsIncomplete = rows.some((r) => r.baseInvested === null && Number(r.invested) !== 0);

  if (isLoading) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Holdings"
        subtitle={`${open.length} open position${open.length === 1 ? "" : "s"}${closed.length > 0 ? ` · ${closed.length} closed` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
            <div className="w-40 shrink-0">
              <Input className="h-9" placeholder="Search symbol…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select className="h-9 w-auto min-w-32 shrink-0" value={assetClass} onChange={(e) => setAssetClass(e.target.value)}>
              <option value="">All classes</option>
              {assetClasses.map((c) => (
                <option key={c} value={c}>
                  {assetClassLabel(c)}
                </option>
              ))}
            </Select>
            <Select className="h-9 w-auto min-w-32 shrink-0" value={sector} onChange={(e) => setSector(e.target.value)}>
              <option value="">All sectors</option>
              {sectors.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <RefreshButton />
          </div>
        }
      />
      {allRows.length === 0 ? (
        <EmptyState title="No holdings yet">
          Import a broker CSV to see your positions.
          <div className="mt-4">
            <Link to="/imports">
              <Button>Import transactions</Button>
            </Link>
          </div>
        </EmptyState>
      ) : searched.length === 0 ? (
        <EmptyState title="No matching holdings">Try clearing the search, class or sector filter.</EmptyState>
      ) : (
        <>
          {closed.length > 0 && (
            <label className="mb-3 flex w-fit items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="h-4 w-4" />
              Show {closed.length} closed position{closed.length === 1 ? "" : "s"} too
            </label>
          )}
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="sticky top-0 z-10 border-b bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={`cursor-pointer select-none px-4 py-3 font-medium hover:text-foreground ${c.align === "right" ? "text-right" : ""}`}
                      title={c.hint}
                      onClick={() => toggleSort(c.key)}
                    >
                      {c.label}
                      {sortKey === c.key && <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => {
                  const isShort = Number(h.netQty) < 0;
                  return (
                    <tr
                      key={h.security.id}
                      className={`border-b last:border-0 hover:bg-accent/50 ${isShort ? "border-l-2 border-l-warning" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-medium">
                          {h.security.symbol}
                          {/* Net short right now is a position, not a data problem; only flag "check
                              history" when a past sell exceeded holdings but the position isn't short. */}
                          {isShort ? <Badge tone="warning">short</Badge> : h.hasOversell && <Badge tone="warning">check history</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {assetClassLabel(h.security.assetClass)}
                          {h.security.sector ? ` · ${h.security.sector}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular">{qty(h.netQty)}</td>
                      <td className="px-4 py-3 text-right font-mono tabular">{money(h.avgCost, h.security.currency)}</td>
                      <td
                        className="px-4 py-3 text-right font-mono tabular"
                        title={isShort ? "Credit received for this short — its basis. A short deploys no capital." : undefined}
                      >
                        {money(isShort ? h.shortProceeds : h.invested, h.security.currency)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular">
                        {h.quote?.estimated && (
                          <span
                            className="mr-1 text-xs text-muted-foreground"
                            title="Estimated from the live underlying (Black-Scholes / cost-of-carry) — not an exchange-quoted price. No free live feed exists for Indian F&O contracts."
                          >
                            ≈
                          </span>
                        )}
                        {money(h.currentValue, h.security.currency)}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono tabular ${signClass(h.unrealisedPnl)}`}>
                        {h.unrealisedPnl === null ? "—" : money(h.unrealisedPnl, h.security.currency)}
                        {h.unrealisedPct !== null && <span className="ml-1 text-xs">({pct(h.unrealisedPct)})</span>}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono tabular ${signClass(h.realisedPnl)}`}>
                        {money(h.realisedPnl, h.security.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30 text-sm font-medium">
                  <td className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">
                    Total ({rows.length}){totalsIncomplete ? " *" : ""}
                  </td>
                  <td />
                  <td />
                  <td className="px-4 py-3 text-right font-mono tabular">{money(totals.invested, baseCurrency)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular">{money(totals.current, baseCurrency)}</td>
                  <td className={`px-4 py-3 text-right font-mono tabular ${signClass(totals.unrealised)}`}>
                    {money(totals.unrealised, baseCurrency)}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono tabular ${signClass(totals.realised)}`}>
                    {money(totals.realised, baseCurrency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </Card>
          {totalsIncomplete && (
            <p className="mt-2 text-xs text-muted-foreground">
              * Totals are in {baseCurrency} and exclude positions without a currency conversion rate yet.
            </p>
          )}
        </>
      )}
    </>
  );
}
