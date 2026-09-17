import { Decimal, d, ZERO, safeDiv } from "./money.js";
import type { CanonicalTx, Quote } from "./types.js";

/**
 * Average-cost holdings & realised-P&L engine. Pure and deterministic.
 * Input: canonical transactions (any order). Output: one row per security.
 * See docs/CALCULATIONS.md for the formulas this implements.
 */

export interface Holding {
  securityId: string;
  netQty: Decimal;
  /** Cost basis of the currently-held quantity (buy-side charges included). */
  invested: Decimal;
  avgCost: Decimal | null;
  realisedPnl: Decimal;
  dividends: Decimal;
  feesTotal: Decimal;
  taxesTotal: Decimal;
  /** Only when a quote is supplied; otherwise null (unknown, never faked to 0). */
  currentValue: Decimal | null;
  unrealisedPnl: Decimal | null;
  unrealisedPct: Decimal | null;
  todayChange: Decimal | null;
  netPnl: Decimal | null;
  /** True if sells exceeded known holdings — signals incomplete import history. */
  hasOversell: boolean;
  /**
   * Cost basis of the current holding expressed in the base currency using the FX rate at
   * each buy's trade date (`fxRateToBase`). Null unless every contributing buy carried a
   * rate — needed to split total return into asset vs currency components. See CALCULATIONS.md.
   */
  investedBaseAtCost: Decimal | null;
  /** Weighted-average FX-at-cost (base per 1 local): investedBaseAtCost / invested. */
  avgFxAtCost: Decimal | null;
}

interface Running {
  qty: Decimal;
  cost: Decimal; // cost basis of current qty (local currency)
  costBase: Decimal; // cost basis in base currency, using FX-at-cost of each buy
  fxCostKnown: boolean; // every contributing buy carried an fxRateToBase
  realised: Decimal;
  dividends: Decimal;
  fees: Decimal;
  taxes: Decimal;
  oversell: boolean;
}

function sortTxs(txs: CanonicalTx[]): CanonicalTx[] {
  return [...txs].sort((a, b) => {
    if (a.tradeDate < b.tradeDate) return -1;
    if (a.tradeDate > b.tradeDate) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function empty(): Running {
  return {
    qty: ZERO,
    cost: ZERO,
    costBase: ZERO,
    fxCostKnown: true,
    realised: ZERO,
    dividends: ZERO,
    fees: ZERO,
    taxes: ZERO,
    oversell: false,
  };
}

function apply(r: Running, tx: CanonicalTx): void {
  const qty = d(tx.quantity);
  const price = d(tx.price);
  const fees = d(tx.fees);
  const taxes = d(tx.taxes);

  switch (tx.type) {
    case "buy":
    case "transfer_in": {
      const costLocal = qty.times(price).plus(fees).plus(taxes);
      r.qty = r.qty.plus(qty);
      r.cost = r.cost.plus(costLocal);
      // Track base-currency cost using the FX rate at this buy's date (for return decomposition).
      if (tx.fxRateToBase != null && tx.fxRateToBase !== "") {
        r.costBase = r.costBase.plus(costLocal.times(d(tx.fxRateToBase)));
      } else {
        r.fxCostKnown = false; // a buy without a known rate → can't decompose FX
      }
      r.fees = r.fees.plus(fees);
      r.taxes = r.taxes.plus(taxes);
      break;
    }
    case "bonus": {
      // Extra shares at zero incremental cost → average cost falls (cost basis unchanged).
      r.qty = r.qty.plus(qty);
      break;
    }
    case "split": {
      // Stock split / consolidation: `price` is the ratio (new shares per old share).
      // Quantity scales; total cost basis is unchanged, so average cost adjusts automatically.
      if (price.greaterThan(0)) r.qty = r.qty.times(price);
      break;
    }
    case "sell":
    case "transfer_out": {
      const avg = safeDiv(r.cost, r.qty); // avg cost at time of sale
      let costRemoved = ZERO;
      if (avg === null || qty.greaterThan(r.qty)) {
        // Selling more than we know we hold: use what cost we have, flag it.
        if (qty.greaterThan(r.qty)) r.oversell = true;
        costRemoved = r.cost; // remove all remaining known cost
      } else {
        costRemoved = avg.times(qty);
      }
      const proceeds = qty.times(price);
      r.realised = r.realised.plus(proceeds.minus(costRemoved).minus(fees).minus(taxes));
      // Reduce base-currency cost proportionally so avg FX-at-cost is preserved.
      if (r.cost.greaterThan(0)) r.costBase = r.costBase.times(r.cost.minus(costRemoved).div(r.cost));
      r.qty = r.qty.minus(qty);
      r.cost = r.cost.minus(costRemoved);
      if (r.qty.lessThanOrEqualTo(0)) {
        r.qty = r.qty.isNegative() ? r.qty : ZERO;
        r.cost = ZERO;
        r.costBase = ZERO;
        r.fxCostKnown = true; // position closed → a fresh re-entry can decompose again
      }
      r.fees = r.fees.plus(fees);
      r.taxes = r.taxes.plus(taxes);
      break;
    }
    case "dividend":
    case "interest": {
      r.dividends = r.dividends.plus(d(tx.grossAmount));
      break;
    }
    case "fee": {
      r.fees = r.fees.plus(d(tx.grossAmount).abs());
      break;
    }
    case "tax": {
      r.taxes = r.taxes.plus(d(tx.grossAmount).abs());
      break;
    }
    // deposit / withdrawal are cash-only (no security); handled by cash-balance calc.
    default:
      break;
  }
}

export interface ComputeOptions {
  quotes?: Map<string, Quote>;
}

export function computeHoldings(
  txs: CanonicalTx[],
  options: ComputeOptions = {},
): Holding[] {
  const bySecurity = new Map<string, Running>();
  for (const tx of sortTxs(txs)) {
    if (!tx.securityId) continue; // pure-cash tx: excluded from per-security holdings
    let run = bySecurity.get(tx.securityId);
    if (!run) {
      run = empty();
      bySecurity.set(tx.securityId, run);
    }
    apply(run, tx);
  }

  const holdings: Holding[] = [];
  for (const [securityId, r] of bySecurity) {
    const invested = r.cost;
    const avgCost = safeDiv(r.cost, r.qty);
    const canDecompose = r.fxCostKnown && r.qty.greaterThan(0);
    const investedBaseAtCost = canDecompose ? r.costBase : null;
    const avgFxAtCost = canDecompose ? safeDiv(r.costBase, r.cost) : null;

    let currentValue: Decimal | null = null;
    let unrealisedPnl: Decimal | null = null;
    let unrealisedPct: Decimal | null = null;
    let todayChange: Decimal | null = null;

    const quote = options.quotes?.get(securityId);
    if (quote && r.qty.greaterThan(0)) {
      const price = d(quote.price);
      currentValue = r.qty.times(price);
      unrealisedPnl = currentValue.minus(invested);
      unrealisedPct = safeDiv(unrealisedPnl, invested);
      if (quote.prevClose != null && quote.prevClose !== "") {
        todayChange = r.qty.times(price.minus(d(quote.prevClose)));
      }
    }

    const netPnl =
      unrealisedPnl === null
        ? null
        : unrealisedPnl.plus(r.realised).plus(r.dividends);

    holdings.push({
      securityId,
      netQty: r.qty,
      invested,
      avgCost,
      realisedPnl: r.realised,
      dividends: r.dividends,
      feesTotal: r.fees,
      taxesTotal: r.taxes,
      currentValue,
      unrealisedPnl,
      unrealisedPct,
      todayChange,
      netPnl,
      hasOversell: r.oversell,
      investedBaseAtCost,
      avgFxAtCost,
    });
  }
  return holdings;
}
