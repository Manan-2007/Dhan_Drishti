import { Decimal, ZERO, safeDiv } from "./money.js";

/**
 * Average-cost position arithmetic, shared by the holdings engine and the realised-P&L walk so
 * both always agree. Handles a position being LONG (qty > 0), FLAT (0) or SHORT (qty < 0).
 *
 * A short is a real position with a basis, not an accounting error: selling what you don't hold
 * credits you `shortProceeds` and leaves you owing `|qty|` units. P&L is realised only when the
 * short is covered (bought back) — never at the moment of shorting, which would book the whole
 * sale proceeds as if it were profit.
 */

export interface Position {
  /** Signed quantity: > 0 long, < 0 short, 0 flat. */
  qty: Decimal;
  /** Cost basis of the LONG quantity, buy-side charges included (0 when flat or short). */
  cost: Decimal;
  /** Net credit received for the OPEN SHORT quantity, sell-side charges deducted (0 otherwise). */
  shortProceeds: Decimal;
}

export interface TradeOutcome {
  position: Position;
  /** P&L locked in by this trade (closing a long, or covering a short). Zero when it only opens. */
  realised: Decimal;
  /** Gross cash from the closing leg — informational, for realised-event reporting. */
  proceeds: Decimal;
  /** Basis released by the closing leg: cost basis (long) or short credit (cover). */
  basisReleased: Decimal;
  /** Cost of the portion of a BUY that opened/extended a long — the only part with an FX basis. */
  openedLongCost: Decimal;
  /** True when this trade closed part of a position (so it produced a realised event). */
  closedSomething: boolean;
  /** True when a SELL drove the position below zero (deliberate short, or missing buy history). */
  wentShort: boolean;
}

export function emptyPosition(): Position {
  return { qty: ZERO, cost: ZERO, shortProceeds: ZERO };
}

/** Split a charge pro-rata by quantity between a trade's two legs. */
function shareOf(total: Decimal, part: Decimal, whole: Decimal): Decimal {
  if (whole.isZero()) return ZERO;
  return total.times(part).div(whole);
}

/**
 * Normalize the trailing state so a position never carries a basis it shouldn't:
 * a net-short position has no long cost, and a flat/long position has no short credit.
 * This also clears rounding dust left by proportional basis release.
 */
function normalize(qty: Decimal, cost: Decimal, shortProceeds: Decimal): Position {
  if (qty.isNegative()) return { qty, cost: ZERO, shortProceeds };
  if (qty.isZero()) return { qty: ZERO, cost: ZERO, shortProceeds: ZERO };
  return { qty, cost, shortProceeds: ZERO };
}

/**
 * Apply a SELL (or transfer_out). The quantity first closes any long inventory (realising P&L
 * against average cost); whatever remains opens or extends a short, crediting `shortProceeds`
 * rather than booking proceeds as profit.
 */
export function applySell(p: Position, quantity: Decimal, price: Decimal, fees: Decimal, taxes: Decimal): TradeOutcome {
  const qty = quantity;
  const longQty = Decimal.max(p.qty, ZERO);
  const closeQty = Decimal.min(qty, longQty);
  const shortQty = qty.minus(closeQty);

  const feesClose = shareOf(fees, closeQty, qty);
  const taxesClose = shareOf(taxes, closeQty, qty);
  const feesShort = fees.minus(feesClose);
  const taxesShort = taxes.minus(taxesClose);

  let realised = ZERO;
  let basisReleased = ZERO;
  let proceeds = ZERO;
  if (closeQty.greaterThan(0)) {
    const avg = safeDiv(p.cost, p.qty);
    basisReleased = avg === null ? p.cost : avg.times(closeQty);
    proceeds = closeQty.times(price);
    realised = proceeds.minus(basisReleased).minus(feesClose).minus(taxesClose);
  }

  let shortProceeds = p.shortProceeds;
  if (shortQty.greaterThan(0)) {
    shortProceeds = shortProceeds.plus(shortQty.times(price)).minus(feesShort).minus(taxesShort);
  }

  const qtyAfter = p.qty.minus(qty);
  return {
    position: normalize(qtyAfter, p.cost.minus(basisReleased), shortProceeds),
    realised,
    proceeds,
    basisReleased,
    openedLongCost: ZERO,
    closedSomething: closeQty.greaterThan(0),
    wentShort: shortQty.greaterThan(0),
  };
}

/**
 * Apply a BUY (or transfer_in). The quantity first covers any open short — realising
 * (short credit − buy-back cost) — and only the remainder opens or extends a long.
 */
export function applyBuy(p: Position, quantity: Decimal, price: Decimal, fees: Decimal, taxes: Decimal): TradeOutcome {
  const qty = quantity;
  const shortOpen = Decimal.max(p.qty.negated(), ZERO);
  const coverQty = Decimal.min(qty, shortOpen);
  const openQty = qty.minus(coverQty);

  const feesCover = shareOf(fees, coverQty, qty);
  const taxesCover = shareOf(taxes, coverQty, qty);
  const feesOpen = fees.minus(feesCover);
  const taxesOpen = taxes.minus(taxesCover);

  let realised = ZERO;
  let basisReleased = ZERO;
  let shortProceeds = p.shortProceeds;
  if (coverQty.greaterThan(0)) {
    const avgShort = safeDiv(p.shortProceeds, shortOpen);
    basisReleased = avgShort === null ? p.shortProceeds : avgShort.times(coverQty);
    realised = basisReleased.minus(coverQty.times(price)).minus(feesCover).minus(taxesCover);
    shortProceeds = shortProceeds.minus(basisReleased);
  }

  const openedLongCost = openQty.greaterThan(0) ? openQty.times(price).plus(feesOpen).plus(taxesOpen) : ZERO;
  const qtyAfter = p.qty.plus(qty);
  return {
    position: normalize(qtyAfter, p.cost.plus(openedLongCost), shortProceeds),
    realised,
    proceeds: ZERO, // a cover is a cash outflow; `basisReleased` carries the credit being closed
    basisReleased,
    openedLongCost,
    closedSomething: coverQty.greaterThan(0),
    wentShort: false,
  };
}

export interface MarkToMarket {
  currentValue: Decimal;
  unrealisedPnl: Decimal;
  /** Denominator for the unrealised percentage: cost for a long, credit received for a short. */
  basis: Decimal;
}

/**
 * Value an open position at `price`. A short's current value is NEGATIVE — it's a liability
 * (what it would cost to buy back), so it correctly subtracts from net worth; its unrealised
 * P&L is the credit received less that buy-back cost, so a falling price is a gain.
 */
export function markToMarket(p: Position, price: Decimal): MarkToMarket | null {
  if (p.qty.isZero()) return null;
  const currentValue = p.qty.times(price);
  if (p.qty.greaterThan(0)) {
    return { currentValue, unrealisedPnl: currentValue.minus(p.cost), basis: p.cost };
  }
  // Short: shortProceeds − |qty|·price, which is exactly shortProceeds + (negative) currentValue.
  return { currentValue, unrealisedPnl: p.shortProceeds.plus(currentValue), basis: p.shortProceeds };
}

/**
 * The per-unit basis to display: average cost for a long, average price shorted at for a short
 * (brokers show the entry price either way). Null when flat or when the basis is unknown.
 */
export function averageBasis(p: Position): Decimal | null {
  if (p.qty.greaterThan(0)) return safeDiv(p.cost, p.qty);
  if (p.qty.isNegative()) return safeDiv(p.shortProceeds, p.qty.negated());
  return null;
}

/** Scale a position's quantity by a split/consolidation ratio; total basis is unchanged. */
export function applySplit(p: Position, ratio: Decimal): Position {
  if (!ratio.greaterThan(0)) return p;
  return { ...p, qty: p.qty.times(ratio) };
}

/** Extra units at no incremental cost (average cost falls; a short is unaffected in basis). */
export function applyBonus(p: Position, quantity: Decimal): Position {
  return { ...p, qty: p.qty.plus(quantity) };
}
