import { Decimal, d, ZERO } from "./money.js";
import type { CanonicalTx } from "./types.js";
import { sortLedger } from "./order.js";

/**
 * FIFO capital-gains matching for Indian ITR. Unlike the average-cost realised engine (which
 * powers Holdings & Analytics), capital-gains tax uses first-in-first-out lots and the holding
 * period of each lot, so this is a separate, purpose-built pass. Pure & deterministic.
 *
 * Every disposal is matched against the oldest open lots. A lot's holding period decides short-
 * vs long-term via a caller-supplied threshold (it differs by asset class and changes with the
 * Union Budget, so the caller owns that rule). F&O is business/speculative income, not capital
 * gains, and is excluded. See docs/CALCULATIONS.md. NOT tax advice.
 */

const DAY = 86_400_000;

interface Lot {
  qty: Decimal;
  costPerUnit: Decimal; // acquisition cost incl. buy fees & taxes, per unit
  date: string; // acquisition date (ISO)
  /** Exchange rate (base per unit) on the purchase day, when the trade carries one. */
  fx: string | null;
  /** An opening balance from a holdings statement: bought before the files start, day unknown. */
  dateUnknown: boolean;
}

export interface CapitalGainRow {
  securityId: string;
  buyDate: string; // YYYY-MM-DD (acquisition)
  sellDate: string; // YYYY-MM-DD (disposal)
  quantity: string;
  proceeds: string; // net sale value for this lot (after pro-rata sell fees/taxes)
  cost: string; // acquisition cost of this lot
  gain: string; // proceeds − cost
  holdingDays: number;
  term: "short" | "long";
  /** The lot is an opening balance: bought before the files start, so the real holding period is unknown (likely longer). */
  buyDateKnown: boolean;
  /** Exchange rates (base per unit) on the buy and sell days when the trades carry them — for foreign shares. */
  buyFx: string | null;
  sellFx: string | null;
}

/** A sale with no purchase on record to match: shares bought before the files start. */
export interface UnmatchedSale {
  securityId: string;
  sellDate: string;
  quantity: string;
  proceeds: string;
}

export interface CapitalGainsOptions {
  /** Days a lot must be held to qualify as long-term, by security id (differs by asset class). */
  longTermDays: (securityId: string) => number;
  /** Told about each sale that found no lot to match (it has no cost on record, so no gain row). */
  onUnmatchedSale?: (sale: UnmatchedSale) => void;
}


const daysBetween = (fromISO: string, toISO: string): number => Math.floor((Date.parse(toISO) - Date.parse(fromISO)) / DAY);

/**
 * Walk the ledger per security, FIFO-matching each sale against open lots and emitting one
 * capital-gain row per (lot, sale) chunk. Buys/transfers-in open lots; sells/transfers-out
 * consume them (only a `sell` is a taxable disposal); bonuses add zero-cost lots; splits scale
 * lots (cost basis and acquisition date unchanged). F&O and commodity trades are skipped.
 */
export function fifoCapitalGains(txs: CanonicalTx[], opts: CapitalGainsOptions): CapitalGainRow[] {
  const lotsBySec = new Map<string, Lot[]>();
  // Units sold today with no lot to match — an intraday short, unless the day ends first (then
  // they were bought before the history; see settleUnmatchedSale). A same-day buy covers them.
  interface Leg {
    date: string;
    qty: Decimal;
    unitProceeds: Decimal;
    isSale: boolean;
  }
  const shortToday = new Map<string, { day: string; qty: Decimal; legs: Leg[] }>();
  const rows: CapitalGainRow[] = [];
  // The day ended with units still sold short: they were bought before the history.
  const settle = (sid: string) => {
    const open = shortToday.get(sid);
    shortToday.delete(sid);
    if (!open || !opts.onUnmatchedSale) return;
    for (const leg of open.legs) {
      if (!leg.isSale || !leg.qty.greaterThan(0)) continue;
      opts.onUnmatchedSale({ securityId: sid, sellDate: leg.date, quantity: leg.qty.toFixed(), proceeds: leg.qty.times(leg.unitProceeds).toFixed() });
    }
  };

  for (const tx of sortLedger(txs)) {
    // F&O and commodity derivatives are business income, not capital gains.
    if (!tx.securityId || tx.segment === "fno" || tx.segment === "commodity") continue;
    const sid = tx.securityId;
    const lots = lotsBySec.get(sid) ?? lotsBySec.set(sid, []).get(sid)!;
    const day = tx.tradeDate.slice(0, 10);
    const short = shortToday.get(sid);
    if (short && short.day !== day) settle(sid);
    let qty = d(tx.quantity);
    const price = d(tx.price);
    const fees = d(tx.fees).plus(d(tx.taxes));

    if (tx.type === "buy" || tx.type === "transfer_in") {
      if (qty.lessThanOrEqualTo(0)) continue;
      const cost = qty.times(price).plus(fees);
      const open = shortToday.get(sid);
      if (open) {
        // Buying back an intraday short: speculative income, not a holding — no lot for that part.
        const cover = Decimal.min(qty, open.qty);
        open.qty = open.qty.minus(cover);
        let left = cover;
        for (const leg of open.legs) {
          const take = Decimal.min(left, leg.qty);
          leg.qty = leg.qty.minus(take);
          left = left.minus(take);
        }
        if (open.qty.lessThanOrEqualTo(0)) shortToday.delete(sid);
        qty = qty.minus(cover);
        if (qty.lessThanOrEqualTo(0)) continue;
      }
      lots.push({ qty, costPerUnit: cost.div(d(tx.quantity)), date: tx.tradeDate, fx: tx.fxRateToBase ?? null, dateUnknown: tx.sourceBroker === "snapshot" });
    } else if (tx.type === "bonus") {
      if (qty.greaterThan(0)) lots.push({ qty, costPerUnit: ZERO, date: tx.tradeDate, fx: tx.fxRateToBase ?? null, dateUnknown: false });
    } else if (tx.type === "split") {
      // `price` carries the ratio (new shares per old); qty scales up, cost basis unchanged.
      if (price.greaterThan(0)) for (const lot of lots) { lot.qty = lot.qty.times(price); lot.costPerUnit = lot.costPerUnit.div(price); }
    } else if (tx.type === "sell" || tx.type === "transfer_out") {
      const isSale = tx.type === "sell";
      const totalQty = qty;
      let remaining = qty;
      while (remaining.greaterThan(0) && lots.length > 0) {
        const lot = lots[0]!;
        const take = Decimal.min(remaining, lot.qty);
        if (isSale && totalQty.greaterThan(0)) {
          const proceeds = take.times(price).minus(fees.times(take.div(totalQty)));
          const cost = take.times(lot.costPerUnit);
          const holdingDays = daysBetween(lot.date, tx.tradeDate);
          rows.push({
            securityId: sid,
            buyDate: lot.date.slice(0, 10),
            sellDate: tx.tradeDate.slice(0, 10),
            quantity: take.toFixed(),
            proceeds: proceeds.toFixed(),
            cost: cost.toFixed(),
            gain: proceeds.minus(cost).toFixed(),
            holdingDays,
            term: holdingDays > opts.longTermDays(sid) ? "long" : "short",
            buyDateKnown: !lot.dateUnknown,
            buyFx: lot.fx,
            sellFx: tx.fxRateToBase ?? null,
          });
        }
        lot.qty = lot.qty.minus(take);
        remaining = remaining.minus(take);
        if (lot.qty.lessThanOrEqualTo(0)) lots.shift();
      }
      // Units with no lot contribute no CG row. Kept for the day in case they're bought back.
      if (remaining.greaterThan(0)) {
        const open = shortToday.get(sid) ?? { day, qty: ZERO, legs: [] };
        open.qty = open.qty.plus(remaining);
        const unit = totalQty.greaterThan(0) ? price.minus(fees.div(totalQty)) : price;
        open.legs.push({ date: day, qty: remaining, unitProceeds: unit, isSale });
        shortToday.set(sid, open);
      }
    }
  }
  for (const sid of [...shortToday.keys()]) settle(sid);
  return rows;
}
