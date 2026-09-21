import { Decimal, d, ZERO, safeDiv } from "./money.js";
import type { CanonicalTx, Quote } from "./types.js";
import {
  applyBonus,
  applyBuy,
  applySell,
  applySplit,
  averageBasis,
  emptyPosition,
  markToMarket,
  type Position,
} from "./position.js";

/**
 * Average-cost holdings & realised-P&L engine. Pure and deterministic.
 * Input: canonical transactions (any order). Output: one row per security.
 * See docs/CALCULATIONS.md for the formulas this implements.
 */

export interface Holding {
  securityId: string;
  /** Signed: > 0 long, < 0 short (sold more than held — an F&O short or missing buy history). */
  netQty: Decimal;
  /** Cost basis of the currently-held quantity (buy-side charges included). Zero for a short. */
  invested: Decimal;
  /**
   * Net credit received for an open SHORT quantity (sell-side charges deducted); zero otherwise.
   * This is the short's basis — P&L against it is realised only when the position is covered.
   */
  shortProceeds: Decimal;
  /** Average cost for a long; average price shorted at for a short (what brokers display). */
  avgCost: Decimal | null;
  realisedPnl: Decimal;
  dividends: Decimal;
  feesTotal: Decimal;
  taxesTotal: Decimal;
  /**
   * Only when a quote is supplied; otherwise null (unknown, never faked to 0).
   * NEGATIVE for a short position — it's a liability (the cost to buy the units back).
   */
  currentValue: Decimal | null;
  unrealisedPnl: Decimal | null;
  unrealisedPct: Decimal | null;
  todayChange: Decimal | null;
  netPnl: Decimal | null;
  /**
   * True if sells drove the position net short. Expected for F&O (selling to open); for
   * delivery equity it usually signals buy history that wasn't imported.
   */
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
  pos: Position; // signed qty + long cost basis + open short credit (local currency)
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
    pos: emptyPosition(),
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
      // Covers any open short first; only the remainder opens a long and carries an FX basis.
      const out = applyBuy(r.pos, qty, price, fees, taxes);
      r.pos = out.position;
      r.realised = r.realised.plus(out.realised);
      if (out.openedLongCost.greaterThan(0)) {
        if (tx.fxRateToBase != null && tx.fxRateToBase !== "") {
          r.costBase = r.costBase.plus(out.openedLongCost.times(d(tx.fxRateToBase)));
        } else {
          r.fxCostKnown = false; // a buy without a known rate → can't decompose FX
        }
      }
      r.fees = r.fees.plus(fees);
      r.taxes = r.taxes.plus(taxes);
      break;
    }
    case "bonus": {
      // Extra shares at zero incremental cost → average cost falls (cost basis unchanged).
      r.pos = applyBonus(r.pos, qty);
      break;
    }
    case "split": {
      // Stock split / consolidation: `price` is the ratio (new shares per old share).
      // Quantity scales; total cost basis is unchanged, so average cost adjusts automatically.
      r.pos = applySplit(r.pos, price);
      break;
    }
    case "sell":
    case "transfer_out": {
      // Closes long inventory first; any excess opens a short (credited, not booked as profit).
      const costBefore = r.pos.cost;
      const out = applySell(r.pos, qty, price, fees, taxes);
      r.pos = out.position;
      r.realised = r.realised.plus(out.realised);
      if (out.wentShort) r.oversell = true;
      // Reduce base-currency cost proportionally so avg FX-at-cost is preserved.
      if (costBefore.greaterThan(0)) {
        r.costBase = r.costBase.times(costBefore.minus(out.basisReleased).div(costBefore));
      }
      if (!r.pos.qty.greaterThan(0)) {
        r.costBase = ZERO;
        r.fxCostKnown = true; // long closed → a fresh re-entry can decompose again
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
    const invested = r.pos.cost;
    const avgCost = averageBasis(r.pos);
    const canDecompose = r.fxCostKnown && r.pos.qty.greaterThan(0);
    const investedBaseAtCost = canDecompose ? r.costBase : null;
    const avgFxAtCost = canDecompose ? safeDiv(r.costBase, r.pos.cost) : null;

    let currentValue: Decimal | null = null;
    let unrealisedPnl: Decimal | null = null;
    let unrealisedPct: Decimal | null = null;
    let todayChange: Decimal | null = null;

    const quote = options.quotes?.get(securityId);
    if (quote) {
      const price = d(quote.price);
      // Marks LONG and SHORT alike: a short's value is negative (a buy-back liability) and its
      // unrealised P&L is the credit received less that liability, so a falling price is a gain.
      const mark = markToMarket(r.pos, price);
      if (mark) {
        currentValue = mark.currentValue;
        unrealisedPnl = mark.unrealisedPnl;
        unrealisedPct = safeDiv(unrealisedPnl, mark.basis);
        if (quote.prevClose != null && quote.prevClose !== "") {
          // Signed qty makes this correct both ways: a short loses when the price rises.
          todayChange = r.pos.qty.times(price.minus(d(quote.prevClose)));
        }
      }
    }

    const netPnl =
      unrealisedPnl === null
        ? null
        : unrealisedPnl.plus(r.realised).plus(r.dividends);

    holdings.push({
      securityId,
      netQty: r.pos.qty,
      invested,
      shortProceeds: r.pos.shortProceeds,
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
