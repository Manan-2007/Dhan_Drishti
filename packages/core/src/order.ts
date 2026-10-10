import type { CanonicalTx, TxType } from "./types.js";

/**
 * The one order every engine walks the ledger in. Average-cost P&L depends on sequence, so it must
 * be the same on every import and every machine — never a database id, which is random.
 *
 * Same timestamp: corporate actions first (a split or bonus takes effect at the start of its day),
 * then acquisitions, then disposals, then income and cash (which don't move a position). Then a
 * key taken from the row itself — the broker's trade id, else the row's fingerprint — so identical
 * data always sorts identically.
 */
const RANK: Record<TxType, number> = {
  split: 0,
  bonus: 1,
  buy: 2,
  transfer_in: 2,
  sell: 3,
  transfer_out: 3,
  dividend: 4,
  interest: 4,
  fee: 4,
  tax: 4,
  deposit: 4,
  withdrawal: 4,
};

const stableKey = (t: CanonicalTx) => t.externalRef ?? t.rawRowHash ?? t.id;

export function ledgerOrder(a: CanonicalTx, b: CanonicalTx): number {
  if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1;
  const ra = RANK[a.type] ?? 5;
  const rb = RANK[b.type] ?? 5;
  if (ra !== rb) return ra - rb;
  const ka = stableKey(a);
  const kb = stableKey(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * A split is a fact about the stock, not the account: when the same split is on record twice (two
 * accounts holding the stock, say, each with its own row), it's applied once.
 */
const splitKey = (t: CanonicalTx) => `${t.securityId}|${t.tradeDate.slice(0, 10)}|${Number(t.price)}`;

export function sortLedger(txs: CanonicalTx[]): CanonicalTx[] {
  const sorted = [...txs].sort(ledgerOrder);
  if (!sorted.some((t) => t.type === "split")) return sorted;
  const seen = new Set<string>();
  return sorted.filter((t) => {
    if (t.type !== "split") return true;
    const k = splitKey(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
