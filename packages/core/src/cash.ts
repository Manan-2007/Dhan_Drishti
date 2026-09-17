import { Decimal, d, ZERO } from "./money.js";
import type { CanonicalTx } from "./types.js";

/**
 * Cash-balance engine: the running cash the portfolio holds, derived from the ledger.
 * Deposits and sale proceeds and income add cash; buys, withdrawals, fees and taxes remove it.
 * Cash is tracked per currency (converted to base for aggregation by the caller). Pure.
 *
 * Cash tracking is only meaningful once you record the money you put in — so callers surface
 * it only when the ledger has explicit deposit/withdrawal events (`hasCashAccounting`).
 */

export interface CashDelta {
  date: string;
  currency: string;
  amount: Decimal; // signed: + adds cash, − removes cash
}

/** Signed cash movement for each transaction (none for bonus/split/transfers of stock). */
export function cashDeltas(txs: CanonicalTx[]): CashDelta[] {
  const out: CashDelta[] = [];
  for (const tx of txs) {
    const gross = d(tx.grossAmount);
    const traded = d(tx.quantity).times(d(tx.price));
    const fees = d(tx.fees);
    const taxes = d(tx.taxes);
    let amount: Decimal | null = null;
    switch (tx.type) {
      case "buy":
        amount = traded.plus(fees).plus(taxes).negated();
        break;
      case "sell":
        amount = traded.minus(fees).minus(taxes);
        break;
      case "deposit":
        amount = gross.abs();
        break;
      case "withdrawal":
        amount = gross.abs().negated();
        break;
      case "dividend":
      case "interest":
        amount = gross;
        break;
      case "fee":
      case "tax":
        amount = gross.abs().negated();
        break;
      default:
        amount = null; // bonus / split / transfer_in / transfer_out: no cash effect
    }
    if (amount !== null) out.push({ date: tx.tradeDate, currency: tx.currency, amount });
  }
  return out;
}

/** Ending cash balance per currency. */
export function cashBalances(txs: CanonicalTx[]): Map<string, Decimal> {
  const balances = new Map<string, Decimal>();
  for (const e of cashDeltas(txs)) balances.set(e.currency, (balances.get(e.currency) ?? ZERO).plus(e.amount));
  return balances;
}

/** Cash balance in one currency including all deltas on or before `date` (YYYY-MM-DD). */
export function cashBalanceAsOf(deltas: CashDelta[], currency: string, date: string): Decimal {
  let bal = ZERO;
  for (const e of deltas) {
    if (e.currency === currency && e.date.slice(0, 10) <= date) bal = bal.plus(e.amount);
  }
  return bal;
}

/** The ledger has explicit cash-account events (deposits/withdrawals) → cash tracking is meaningful. */
export function hasCashAccounting(txs: CanonicalTx[]): boolean {
  return txs.some((t) => t.type === "deposit" || t.type === "withdrawal");
}
