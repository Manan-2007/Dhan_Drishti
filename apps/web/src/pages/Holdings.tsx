import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useFilter, useHoldings } from "../lib/hooks.js";
import { PageHeader } from "../components/PageHeader.js";
import { RefreshButton } from "../components/RefreshButton.js";
import { Button, Card, EmptyState, Spinner, Badge, Select } from "../components/ui.js";
import { money, qty, pct, signClass, assetClassLabel } from "../lib/format.js";

export function Holdings() {
  const { portfolioId } = useFilter();
  const { data, isLoading } = useHoldings(portfolioId);
  const [assetClass, setAssetClass] = useState("");
  const [sector, setSector] = useState("");

  const allRows = data?.holdings ?? [];
  const assetClasses = useMemo(() => [...new Set(allRows.map((r) => r.security.assetClass))].sort(), [allRows]);
  const sectors = useMemo(() => [...new Set(allRows.map((r) => r.security.sector ?? "Unclassified"))].sort(), [allRows]);
  const rows = allRows.filter(
    (r) => (!assetClass || r.security.assetClass === assetClass) && (!sector || (r.security.sector ?? "Unclassified") === sector),
  );
  const open = rows.filter((r) => Number(r.netQty) !== 0);

  if (isLoading) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Holdings"
        subtitle={`${open.length} open position${open.length === 1 ? "" : "s"}`}
        actions={
          <div className="flex items-center gap-2 max-sm:w-full max-sm:flex-wrap">
            <Select className="h-9 w-auto" value={assetClass} onChange={(e) => setAssetClass(e.target.value)}>
              <option value="">All classes</option>
              {assetClasses.map((c) => (
                <option key={c} value={c}>
                  {assetClassLabel(c)}
                </option>
              ))}
            </Select>
            <Select className="h-9 w-auto" value={sector} onChange={(e) => setSector(e.target.value)}>
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
      ) : rows.length === 0 ? (
        <EmptyState title="No matching holdings">Try clearing the class or sector filter.</EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Security</th>
                <th className="px-4 py-3 text-right font-medium">Qty</th>
                <th className="px-4 py-3 text-right font-medium">Avg cost</th>
                <th className="px-4 py-3 text-right font-medium">Invested</th>
                <th className="px-4 py-3 text-right font-medium">Current</th>
                <th className="px-4 py-3 text-right font-medium">Unrealised</th>
                <th className="px-4 py-3 text-right font-medium">Realised</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.security.id} className="border-b last:border-0 hover:bg-accent/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium">
                      {h.security.symbol}
                      {h.hasOversell && <Badge tone="warning">check history</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {assetClassLabel(h.security.assetClass)}
                      {h.security.sector ? ` · ${h.security.sector}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular">{qty(h.netQty)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular">{money(h.avgCost, h.security.currency)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular">{money(h.invested, h.security.currency)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular">{money(h.currentValue, h.security.currency)}</td>
                  <td className={`px-4 py-3 text-right font-mono tabular ${signClass(h.unrealisedPnl)}`}>
                    {h.unrealisedPnl === null ? "—" : money(h.unrealisedPnl, h.security.currency)}
                    {h.unrealisedPct !== null && <span className="ml-1 text-xs">({pct(h.unrealisedPct)})</span>}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono tabular ${signClass(h.realisedPnl)}`}>
                    {money(h.realisedPnl, h.security.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
