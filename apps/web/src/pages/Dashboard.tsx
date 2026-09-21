import { Link } from "react-router-dom";
import { useFilter, useHoldings, usePortfolios, useTransactions } from "../lib/hooks.js";
import { PageHeader } from "../components/PageHeader.js";
import { RefreshButton } from "../components/RefreshButton.js";
import { AllocationCard } from "../components/AllocationCard.js";
import { NetWorthCard } from "../components/NetWorthCard.js";
import { NetWorthChart } from "../components/NetWorthChart.js";
import { TopHoldingsCard } from "../components/TopHoldingsCard.js";
import { Onboarding } from "../components/Onboarding.js";
import { Button, Card, EmptyState, Spinner, Badge } from "../components/ui.js";
import { compactMoney, money, signClass, dateShort, qty } from "../lib/format.js";

function Stat({ label, value, valueClass, hint }: { label: string; value: string; valueClass?: string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono tabular text-xl ${valueClass ?? ""}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function Dashboard() {
  const { portfolioId } = useFilter();
  const { data: portfolios, isLoading: pLoading } = usePortfolios();
  const { data, isLoading } = useHoldings(portfolioId);
  const { data: txData } = useTransactions({ portfolioId, limit: 6 });

  if (pLoading || isLoading) return <Spinner />;

  if (!portfolios || portfolios.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" showFilter={false} />
        <Onboarding />
      </>
    );
  }

  const s = data?.summary;
  const alloc = data?.allocation;
  const hasHoldings = (data?.holdings.length ?? 0) > 0;

  return (
    <>
      <PageHeader title="Dashboard" subtitle={portfolioId ? undefined : "All portfolios"} actions={<RefreshButton />} />

      {!hasHoldings ? (
        <EmptyState title="No holdings yet">
          This portfolio has no transactions. Import a Zerodha CSV to populate it.
          <div className="mt-4">
            <Link to="/imports">
              <Button>Import transactions</Button>
            </Link>
          </div>
        </EmptyState>
      ) : (
        <>
          {!s?.allPriced && (
            <Card className="mb-4 border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
              Showing cost-based figures for unpriced positions — {s?.pricedPositions ?? 0}/{s?.openPositions ?? 0} priced.
              Use <span className="font-medium">Refresh prices</span> to value them.
            </Card>
          )}
          {data && !data.fxComplete && (
            <Card className="mb-4 border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
              Some holdings are in {data.unconvertibleCurrencies.join(", ")} and have no exchange rate yet, so they're
              excluded from the {data.baseCurrency} totals. Use <span className="font-medium">Refresh prices</span> or set a rate in Settings.
            </Card>
          )}

          {data && <NetWorthCard data={data} />}

          <div className="mt-4">
            <NetWorthChart portfolioId={portfolioId} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Invested" value={compactMoney(s?.invested)} hint={money(s?.invested)} />
            <Stat
              label="Current value"
              value={s?.pricedPositions ? compactMoney(s?.currentValue) : "—"}
              hint={s?.pricedPositions ? money(s?.currentValue) : "needs prices"}
            />
            <Stat
              label="Unrealised P&L"
              value={s?.pricedPositions ? compactMoney(s?.unrealisedPnl) : "—"}
              valueClass={s?.pricedPositions ? signClass(s?.unrealisedPnl) : ""}
            />
            <Stat label="Realised P&L" value={compactMoney(s?.realisedPnl)} valueClass={signClass(s?.realisedPnl)} />
            <Stat label="Dividends" value={compactMoney(s?.dividends)} />
            {data?.cashTracked && <Stat label="Cash" value={compactMoney(s?.cash)} hint={money(s?.cash)} />}
            <Stat label="Net P&L" value={compactMoney(s?.netPnl)} valueClass={signClass(s?.netPnl)} />
            <Stat label="Open positions" value={String(s?.openPositions ?? 0)} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {alloc && <AllocationCard allocation={alloc} />}
            {data && <TopHoldingsCard data={data} />}
          </div>

          <div className="mt-4">
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-muted-foreground">Recent transactions</h3>
                <Link to="/transactions" className="text-sm text-muted-foreground underline">
                  View all
                </Link>
              </div>
              {txData && txData.transactions.length > 0 ? (
                <ul className="divide-y">
                  {txData.transactions.map((t) => (
                    <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="flex items-center gap-2">
                        <Badge tone={t.type === "buy" ? "success" : t.type === "sell" ? "danger" : "muted"}>{t.type}</Badge>
                        <span className="text-muted-foreground">{dateShort(t.tradeDate)}</span>
                      </span>
                      <span className="font-mono tabular">
                        {t.type === "split"
                          ? `×${Number(t.price)}`
                          : Number(t.quantity)
                            ? `${qty(t.quantity)} @ ${money(t.price, t.currency)}`
                            : money(t.grossAmount, t.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No transactions yet.</p>
              )}
            </Card>
          </div>
        </>
      )}
      <p className="mt-6 text-center text-xs text-muted-foreground">Figures derive from your imported ledger.</p>
    </>
  );
}
