import { useState } from "react";
import { Link } from "react-router-dom";
import { useFilter, usePortfolios, useTransactions } from "../lib/hooks.js";
import { PageHeader } from "../components/PageHeader.js";
import { AddTransactionModal } from "../components/AddTransactionModal.js";
import { Button, Card, EmptyState, Spinner, Badge, Select } from "../components/ui.js";
import { money, qty, dateShort } from "../lib/format.js";

const TYPES = ["", "buy", "sell", "dividend", "interest", "bonus", "split", "transfer_in", "transfer_out", "deposit", "withdrawal", "fee", "tax"];

export function Transactions() {
  const { portfolioId } = useFilter();
  const { data: portfolios } = usePortfolios();
  const [type, setType] = useState("");
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useTransactions({ portfolioId, type: type || undefined, limit: 200 });

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={data ? `${data.total} total` : undefined}
        actions={
          <>
            <Select className="h-9 w-auto" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === "" ? "All types" : t}
                </option>
              ))}
            </Select>
            <Button className="h-9 px-3" onClick={() => setAdding(true)} disabled={!portfolios || portfolios.length === 0}>
              + Add
            </Button>
          </>
        }
      />
      {adding && portfolios && (
        <AddTransactionModal portfolios={portfolios} defaultPortfolioId={portfolioId} onClose={() => setAdding(false)} />
      )}
      {isLoading ? (
        <Spinner />
      ) : !data || data.transactions.length === 0 ? (
        <EmptyState title="No transactions">
          {type ? "No transactions of this type." : "Import a broker CSV to populate your ledger."}
          {!type && (
            <div className="mt-4">
              <Link to="/imports">
                <Button>Import transactions</Button>
              </Link>
            </div>
          )}
        </EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 text-right font-medium">Qty</th>
                <th className="px-4 py-3 text-right font-medium">Price</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((t) => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-accent/50">
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{dateShort(t.tradeDate)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={t.type === "buy" ? "success" : t.type === "sell" ? "danger" : "muted"}>{t.type}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular">
                    {t.type === "split" ? "—" : Number(t.quantity) ? qty(t.quantity) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular">
                    {t.type === "split" ? `×${Number(t.price)}` : Number(t.price) ? money(t.price, t.currency) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular">
                    {t.type === "split" ? "—" : money(t.grossAmount, t.currency)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{t.sourceBroker ?? "manual"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
