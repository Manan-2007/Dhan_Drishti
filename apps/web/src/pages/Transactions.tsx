import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { useFilter, usePortfolios, useTransactions } from "../lib/hooks.js";
import { PageHeader } from "../components/PageHeader.js";
import { AddTransactionModal } from "../components/AddTransactionModal.js";
import { Button, Card, EmptyState, Spinner, Badge, Select } from "../components/ui.js";
import { money, qty, dateShort, assetClassLabel } from "../lib/format.js";
import type { Transaction } from "../lib/api.js";

const TYPES = ["", "buy", "sell", "dividend", "interest", "bonus", "split", "transfer_in", "transfer_out", "deposit", "withdrawal", "fee", "tax"];

/** Visual direction for the left accent strip + badge tone — buy/sell get the strongest treatment
 * since "what did I buy or sell" is the question this page most needs to answer at a glance. */
const TYPE_STYLE: Record<string, { tone: "success" | "danger" | "muted"; accent: string }> = {
  buy: { tone: "success", accent: "border-l-success" },
  transfer_in: { tone: "success", accent: "border-l-success" },
  bonus: { tone: "success", accent: "border-l-success" },
  sell: { tone: "danger", accent: "border-l-destructive" },
  transfer_out: { tone: "danger", accent: "border-l-destructive" },
  dividend: { tone: "muted", accent: "border-l-transparent" },
  interest: { tone: "muted", accent: "border-l-transparent" },
  deposit: { tone: "muted", accent: "border-l-transparent" },
  withdrawal: { tone: "muted", accent: "border-l-transparent" },
  split: { tone: "muted", accent: "border-l-transparent" },
  fee: { tone: "muted", accent: "border-l-transparent" },
  tax: { tone: "muted", accent: "border-l-transparent" },
};

const SEGMENT_LABELS: Record<string, string> = { equity: "Equity", mf: "Mutual Fund", fno: "F&O", commodity: "Commodity", other: "Other" };

function netCashImpact(t: Transaction): { label: string; value: string } | null {
  const gross = Number(t.grossAmount);
  const fees = Number(t.fees);
  const taxes = Number(t.taxes);
  if (t.type === "buy" || t.type === "transfer_in") return { label: "Cash paid (incl. fees & taxes)", value: money(gross + fees + taxes, t.currency) };
  if (t.type === "sell" || t.type === "transfer_out") return { label: "Cash received (after fees & taxes)", value: money(gross - fees - taxes, t.currency) };
  return null;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono tabular">{value}</dd>
    </div>
  );
}

function ExpandedDetail({ t }: { t: Transaction }) {
  const net = netCashImpact(t);
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
      {t.security && (
        <>
          <DetailRow
            label="Security"
            value={t.security.name !== t.security.symbol ? `${t.security.name} (${t.security.symbol})` : t.security.name}
          />
          <DetailRow label="Asset class" value={assetClassLabel(t.security.assetClass) + (t.security.sector ? ` · ${t.security.sector}` : "")} />
          {t.security.isin && <DetailRow label="ISIN" value={t.security.isin} />}
          {t.security.exchange && <DetailRow label="Exchange" value={t.security.exchange} />}
        </>
      )}
      <DetailRow label="Segment" value={SEGMENT_LABELS[t.segment] ?? t.segment} />
      {t.account && <DetailRow label="Account" value={`${t.account.name} (${t.account.broker})`} />}
      <DetailRow label="Gross amount" value={money(t.grossAmount, t.currency)} />
      <DetailRow label="Fees" value={money(t.fees, t.currency)} />
      <DetailRow label="Taxes" value={money(t.taxes, t.currency)} />
      {net && <DetailRow label={net.label} value={net.value} />}
      {t.fxRateToBase && <DetailRow label="FX rate to base (at cost)" value={t.fxRateToBase} />}
      {t.settleDate && <DetailRow label="Settled" value={dateShort(t.settleDate)} />}
      <DetailRow label="Source" value={t.sourceBroker ?? "Manual entry"} />
      {t.notes && (
        <div className="col-span-full">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Notes</dt>
          <dd className="mt-0.5">{t.notes}</dd>
        </div>
      )}
    </dl>
  );
}

export function Transactions() {
  const { portfolioId } = useFilter();
  const { data: portfolios } = usePortfolios();
  const [type, setType] = useState("");
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { data, isLoading } = useTransactions({ portfolioId, type: type || undefined, limit: 200 });

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={data ? `${data.total} total · amounts shown in each trade's own currency` : undefined}
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
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-8 px-2 py-3" />
                <th className="px-2 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Security</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 text-right font-medium">Qty</th>
                <th className="px-4 py-3 text-right font-medium">Price</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((t) => {
                const style = TYPE_STYLE[t.type] ?? { tone: "muted" as const, accent: "border-l-transparent" };
                const isOpen = expanded.has(t.id);
                return (
                  <Fragment key={t.id}>
                    <tr
                      onClick={() => toggle(t.id)}
                      className={`cursor-pointer border-b border-l-2 ${style.accent} last:border-b-0 hover:bg-accent/50 ${isOpen ? "bg-accent/30" : ""}`}
                    >
                      <td className="px-2 py-3 text-center text-muted-foreground">
                        <span className={`inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-3 text-muted-foreground">{dateShort(t.tradeDate)}</td>
                      <td className="px-4 py-3">
                        {t.security ? (
                          <>
                            <div className="font-medium">
                              <Link to={`/security/${t.security.id}`} className="hover:underline">{t.security.symbol}</Link>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {/* Mutual funds have no short ticker — symbol and name are identical, so
                                  showing the name again would just repeat the line above. */}
                              {t.security.name !== t.security.symbol ? t.security.name : assetClassLabel(t.security.assetClass) + (t.security.sector ? ` · ${t.security.sector}` : "")}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            {t.type === "deposit" || t.type === "withdrawal" ? "Cash" : "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={style.tone}>{t.type}</Badge>
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
                    </tr>
                    {isOpen && (
                      <tr className={`border-b border-l-2 ${style.accent} bg-muted/20 last:border-b-0`}>
                        <td colSpan={7}>
                          <ExpandedDetail t={t} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
