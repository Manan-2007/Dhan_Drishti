import { Decimal, d, ZERO } from "./money.js";
import type { CanonicalTx } from "./types.js";
import { applyBonus, applyBuy, applySell, applySplit, emptyPosition, isDeliverySegment, settleUnmatchedSale, type Position } from "./position.js";
import { sortLedger } from "./order.js";

/**
 * What the investments were worth, and what had gone into them, on each of a list of days — the
 * line a stock app draws. Walks the ledger once with the same position arithmetic as Holdings
 * (average cost, day-end delivery settlement), and on each day values every open position at that
 * day's close in the base currency. A position with no close yet on a day counts at its cost, so
 * a missing price never shows as a crash; `atCost` reports how much was valued that way.
 *
 * Pure: prices and exchange rates come from the caller (`price` should return the last close on
 * or before the day, `fx` the base-currency rate that day; 1 for the base currency itself).
 */

export interface TimelinePoint {
  date: string;
  /** Market value of open positions (base currency). */
  value: number;
  /** Cost basis of open positions (base currency): the money in them. */
  invested: number;
  /** Part of `value` counted at cost because no price was known yet that day. */
  atCost: number;
}

interface Run {
  pos: Position;
  costBase: Decimal; // cost basis in base currency (FX on the purchase day)
  deliveryShort: boolean;
  lastDay: string;
  currency: string;
}

export function valueTimeline(
  txs: CanonicalTx[],
  dates: string[],
  price: (securityId: string, date: string) => number | null,
  fx: (currency: string, date: string) => number | null,
): TimelinePoint[] {
  const ledger = sortLedger(txs.filter((t) => t.securityId));
  const runs = new Map<string, Run>();
  const settle = (r: Run) => {
    if (!r.deliveryShort) return;
    r.deliveryShort = false;
    const s = settleUnmatchedSale(r.pos);
    if (s) {
      r.pos = s.position;
      r.costBase = ZERO;
    }
  };

  const out: TimelinePoint[] = [];
  let i = 0;
  for (const date of [...dates].sort()) {
    const end = `${date}T23:59:59.999Z`;
    for (; i < ledger.length && ledger[i]!.tradeDate <= end; i++) {
      const tx = ledger[i]!;
      const sid = tx.securityId!;
      const r = runs.get(sid) ?? { pos: emptyPosition(), costBase: ZERO, deliveryShort: false, lastDay: "", currency: tx.currency };
      runs.set(sid, r);
      const day = tx.tradeDate.slice(0, 10);
      if (day > r.lastDay) {
        settle(r);
        r.lastDay = day;
      }
      const qty = d(tx.quantity);
      const px = d(tx.price);
      const rate = tx.fxRateToBase ? d(tx.fxRateToBase) : d(fx(tx.currency, day) ?? 1);
      if (tx.type === "buy" || tx.type === "transfer_in") {
        const o = applyBuy(r.pos, qty, px, d(tx.fees), d(tx.taxes));
        r.pos = o.position;
        r.costBase = r.costBase.plus(o.openedLongCost.times(rate));
      } else if (tx.type === "sell" || tx.type === "transfer_out") {
        const before = r.pos.cost;
        const o = applySell(r.pos, qty, px, d(tx.fees), d(tx.taxes));
        r.pos = o.position;
        if (o.wentShort && isDeliverySegment(tx.segment)) r.deliveryShort = true;
        r.costBase = before.greaterThan(0) ? r.costBase.times(before.minus(o.basisReleased).div(before)) : ZERO;
        if (!r.pos.qty.greaterThan(0)) r.costBase = ZERO;
      } else if (tx.type === "split") r.pos = applySplit(r.pos, px);
      else if (tx.type === "bonus") r.pos = applyBonus(r.pos, qty);
    }
    // A day that has ended with a delivery position short: shares bought before the history.
    for (const r of runs.values()) if (r.lastDay < date) settle(r);

    let value = 0;
    let invested = 0;
    let atCost = 0;
    for (const [sid, r] of runs) {
      if (!r.pos.qty.greaterThan(0)) continue;
      const cost = r.costBase.toNumber();
      invested += cost;
      const close = price(sid, date);
      const rate = fx(r.currency, date);
      if (close === null || rate === null) {
        value += cost;
        atCost += cost;
      } else value += r.pos.qty.toNumber() * close * rate;
    }
    out.push({ date, value, invested, atCost });
  }
  return out;
}
