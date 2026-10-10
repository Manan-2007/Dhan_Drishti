import { Decimal, d, ZERO, safeDiv } from "./money.js";
import type { CanonicalTx, Quote } from "./types.js";
import {
  applyBonus,
  applyBuy,
  applySell,
  applySplit,
  averageBasis,
  emptyPosition,
  isDeliverySegment,
  settleUnmatchedSale,
  markToMarket,
  type Position,
} from "./position.js";
import { sortLedger } from "./order.js";

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
   * Delivery units sold with no purchase on record — bought before the imported history (see
   * `settleUnmatchedSale`). They're not held and no profit is counted for them; an older statement
   * would supply the missing cost.
   */
  soldWithoutPurchase: Decimal;
  /** What those units were sold for (sell-side charges deducted). */
  soldWithoutPurchaseProceeds: Decimal;
  /**
   * Cost basis of the current holding expressed in the base currency using the FX rate at
   * each buy's trade date (`fxRateToBase`). Null unless every contributing buy carried a
   * rate — needed to split total return into asset vs currency components. See CALCULATIONS.md.
   */
  investedBaseAtCost: Decimal | null;
  /** Weighted-average FX-at-cost (base per 1 local): investedBaseAtCost / invested. */
  avgFxAtCost: Decimal | null;
  /**
   * Booked profit in the base currency: each sale's proceeds at the sale day's rate, less the cost
   * of what it closed at the buy days' rates. Null unless every event involved carried a rate.
   */
  realisedPnlBase: Decimal | null;
  /** Dividends/interest in the base currency at each payout day's rate (null if any lacked one). */
  dividendsBase: Decimal | null;
}

interface Running {
  pos: Position; // signed qty + long cost basis + open short credit (local currency)
  costBase: Decimal; // cost basis in base currency, using FX-at-cost of each buy
  fxCostKnown: boolean; // every contributing buy carried an fxRateToBase
  realised: Decimal;
  realisedBase: Decimal | null; // null once an event without a rate is involved
  dividends: Decimal;
  dividendsBase: Decimal | null;
  fees: Decimal;
  taxes: Decimal;
  oversell: boolean;
  /** Calendar day (UTC) of the last trade applied — for the day-end delivery settlement. */
  lastDay: string;
  /** The open short came from a delivery sale (equity/MF), so it settles at the day's end. */
  deliveryShort: boolean;
  soldWithoutPurchase: Decimal;
  soldWithoutPurchaseProceeds: Decimal;
}


function empty(): Running {
  return {
    pos: emptyPosition(),
    costBase: ZERO,
    fxCostKnown: true,
    realised: ZERO,
    realisedBase: ZERO,
    dividends: ZERO,
    dividendsBase: ZERO,
    fees: ZERO,
    taxes: ZERO,
    oversell: false,
    lastDay: "",
    deliveryShort: false,
    soldWithoutPurchase: ZERO,
    soldWithoutPurchaseProceeds: ZERO,
  };
}

/** Day-end: a delivery position still short was a sale of shares bought before the history. */
function settleDay(r: Running): void {
  if (!r.deliveryShort) return;
  const settled = settleUnmatchedSale(r.pos);
  r.deliveryShort = false;
  if (!settled) return;
  r.pos = settled.position;
  r.soldWithoutPurchase = r.soldWithoutPurchase.plus(settled.quantity);
  r.soldWithoutPurchaseProceeds = r.soldWithoutPurchaseProceeds.plus(settled.proceeds);
  r.costBase = ZERO;
  r.fxCostKnown = true;
}

/** The tx's own-day rate to the base currency, if it carried one. */
const fxOf = (tx: CanonicalTx): Decimal | null => (tx.fxRateToBase != null && tx.fxRateToBase !== "" ? d(tx.fxRateToBase) : null);

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
      if (!out.realised.isZero()) {
        const fx = fxOf(tx);
        r.realisedBase = fx && r.realisedBase ? r.realisedBase.plus(out.realised.times(fx)) : null;
      }
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
      const costBaseBefore = r.costBase;
      const fxKnownBefore = r.fxCostKnown;
      const out = applySell(r.pos, qty, price, fees, taxes);
      r.pos = out.position;
      r.realised = r.realised.plus(out.realised);
      if (out.wentShort) {
        r.oversell = true;
        r.deliveryShort = isDeliverySegment(tx.segment);
      }
      // Reduce base-currency cost proportionally so avg FX-at-cost is preserved.
      if (costBefore.greaterThan(0)) {
        r.costBase = r.costBase.times(costBefore.minus(out.basisReleased).div(costBefore));
      }
      if (out.closedSomething) {
        // Proceeds (after charges) at today's rate, less the closed cost at the buy days' rates.
        const fx = fxOf(tx);
        r.realisedBase =
          fx && fxKnownBefore && r.realisedBase
            ? r.realisedBase.plus(out.realised.plus(out.basisReleased).times(fx)).minus(costBaseBefore.minus(r.costBase))
            : null;
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
      const fx = fxOf(tx);
      r.dividendsBase = fx && r.dividendsBase ? r.dividendsBase.plus(d(tx.grossAmount).times(fx)) : null;
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
  for (const tx of sortLedger(txs)) {
    if (!tx.securityId) continue; // pure-cash tx: excluded from per-security holdings
    let run = bySecurity.get(tx.securityId);
    if (!run) {
      run = empty();
      bySecurity.set(tx.securityId, run);
    }
    const day = tx.tradeDate.slice(0, 10);
    if (day > run.lastDay) {
      settleDay(run);
      run.lastDay = day;
    }
    apply(run, tx);
  }
  for (const run of bySecurity.values()) settleDay(run);

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
      realisedPnlBase: r.realisedBase,
      dividendsBase: r.dividendsBase,
      feesTotal: r.fees,
      taxesTotal: r.taxes,
      currentValue,
      unrealisedPnl,
      unrealisedPct,
      todayChange,
      netPnl,
      hasOversell: r.oversell,
      soldWithoutPurchase: r.soldWithoutPurchase,
      soldWithoutPurchaseProceeds: r.soldWithoutPurchaseProceeds,
      investedBaseAtCost,
      avgFxAtCost,
    });
  }
  return holdings;
}
