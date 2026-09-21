import { Decimal, d, ZERO } from "./money.js";
import type { CanonicalTx } from "./types.js";

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
}

export interface CapitalGainsOptions {
  /** Days a lot must be held to qualify as long-term, by security id (differs by asset class). */
  longTermDays: (securityId: string) => number;
}

function sortTxs(txs: CanonicalTx[]): CanonicalTx[] {
  return [...txs].sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : a.id < b.id ? -1 : 1));
}

const daysBetween = (fromISO: string, toISO: string): number => Math.floor((Date.parse(toISO) - Date.parse(fromISO)) / DAY);

/**
 * Walk the ledger per security, FIFO-matching each sale against open lots and emitting one
 * capital-gain row per (lot, sale) chunk. Buys/transfers-in open lots; sells/transfers-out
 * consume them (only a `sell` is a taxable disposal); bonuses add zero-cost lots; splits scale
 * lots (cost basis and acquisition date unchanged). F&O trades are skipped.
 */
export function fifoCapitalGains(txs: CanonicalTx[], opts: CapitalGainsOptions): CapitalGainRow[] {
  const lotsBySec = new Map<string, Lot[]>();
  const rows: CapitalGainRow[] = [];

  for (const tx of sortTxs(txs)) {
    if (!tx.securityId || tx.segment === "fno") continue; // derivatives are business income, not CG
    const sid = tx.securityId;
    const lots = lotsBySec.get(sid) ?? lotsBySec.set(sid, []).get(sid)!;
    const qty = d(tx.quantity);
    const price = d(tx.price);
    const fees = d(tx.fees).plus(d(tx.taxes));

    if (tx.type === "buy" || tx.type === "transfer_in") {
      if (qty.lessThanOrEqualTo(0)) continue;
      const cost = qty.times(price).plus(fees);
      lots.push({ qty, costPerUnit: cost.div(qty), date: tx.tradeDate });
    } else if (tx.type === "bonus") {
      if (qty.greaterThan(0)) lots.push({ qty, costPerUnit: ZERO, date: tx.tradeDate });
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
          });
        }
        lot.qty = lot.qty.minus(take);
        remaining = remaining.minus(take);
        if (lot.qty.lessThanOrEqualTo(0)) lots.shift();
      }
      // Any remaining un-matched quantity (an oversell with no open lot) contributes no CG row.
    }
  }
  return rows;
}
