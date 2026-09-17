import { useFilter, useHoldings } from "../lib/hooks.js";
import { Card } from "./ui.js";
import { money, signClass } from "../lib/format.js";

/**
 * Splits the base-currency gain on foreign holdings into the part driven by the asset's own
 * (local-currency) price move and the part driven by the exchange rate moving since you bought.
 * Renders nothing for single-currency (base-only) portfolios — there is no currency component.
 */
export function FxImpactCard() {
  const { portfolioId } = useFilter();
  const { data } = useHoldings(portfolioId);
  const fx = data?.fxImpact;
  if (!fx) return null;

  const base = data!.baseCurrency;
  return (
    <Card className="mt-4">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-muted-foreground">FX impact on foreign holdings</h3>
        <p className="text-xs text-muted-foreground">
          Unrealised gain on non-{base} holdings, split into asset price vs currency movement (in {base}).
        </p>
      </div>

      {fx.decomposablePositions > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Asset return</div>
            <div className={`mt-1 font-mono tabular text-lg ${signClass(fx.assetReturn)}`}>{money(fx.assetReturn, base)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">from the holding's own price</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Currency return</div>
            <div className={`mt-1 font-mono tabular text-lg ${signClass(fx.currencyReturn)}`}>{money(fx.currencyReturn, base)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">from the {base} exchange rate</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Combined</div>
            <div className={`mt-1 font-mono tabular text-lg ${signClass(fx.total)}`}>{money(fx.total, base)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{fx.decomposablePositions} position(s)</div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No priced foreign holdings to decompose yet.</p>
      )}

      {fx.missingCostFxCurrencies.length > 0 && (
        <p className="mt-3 border-t pt-3 text-xs text-warning">
          {fx.missingCostFxCurrencies.join(", ")} holdings have no recorded FX-at-cost, so they're left out of the split.
          Use <span className="font-medium">Refresh prices</span> to backfill historical rates.
        </p>
      )}
    </Card>
  );
}
