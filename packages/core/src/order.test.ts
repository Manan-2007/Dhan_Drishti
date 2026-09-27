import { describe, it, expect } from "vitest";
import { computeHoldings } from "./holdings.js";
import { realisedEvents } from "./performance.js";
import { fifoCapitalGains } from "./tax.js";
import { sortLedger } from "./order.js";
import type { CanonicalTx, TxType } from "./types.js";

function tx(p: Partial<CanonicalTx> & { type: TxType; id: string }): CanonicalTx {
  return {
    id: p.id,
    userId: "u1",
    portfolioId: "p1",
    accountId: null,
    securityId: p.securityId ?? "SEC",
    type: p.type,
    tradeDate: p.tradeDate ?? "2024-01-02T00:00:00.000Z",
    settleDate: null,
    quantity: p.quantity ?? "0",
    price: p.price ?? "0",
    grossAmount: p.grossAmount ?? "0",
    fees: "0",
    taxes: "0",
    currency: "INR",
    fxRateToBase: null,
    segment: "equity",
    externalRef: p.externalRef ?? null,
    rawRowHash: p.rawRowHash ?? null,
    sourceBroker: null,
    notes: null,
  };
}

const trade = (id: string, type: "buy" | "sell", qty: number, price: number, extra: Partial<CanonicalTx> = {}) =>
  tx({ id, type, quantity: String(qty), price: String(price), grossAmount: String(qty * price), ...extra });

// A held position, then a same-day sell + rebuy with only a date to go on (no times). Average-cost
// realised P&L depends on which of the two is walked first — the case that used to flip on import.
const ledger = () => [
  trade("a", "buy", 10, 100, { tradeDate: "2024-01-01T00:00:00.000Z", rawRowHash: "h1" }),
  trade("b", "sell", 10, 150, { rawRowHash: "h2" }),
  trade("c", "buy", 10, 120, { rawRowHash: "h3" }),
];

/** Same rows, fresh random database ids and a shuffled input order — what a re-import produces. */
function reimport(txs: CanonicalTx[], seed: number): CanonicalTx[] {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const copy = txs.map((t) => ({ ...t, id: Math.floor(rand() * 1e9).toString(16) }));
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

describe("ledger order", () => {
  it("gives identical realised P&L however ids and input order come out", () => {
    const results = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const txs = reimport(ledger(), seed);
      const h = computeHoldings(txs, {})[0]!;
      const ev = realisedEvents(txs).map((e) => e.realised.toString()).join(",");
      const cg = fifoCapitalGains(txs, { longTermDays: () => 365 })
        .map((r) => r.gain.toString())
        .join(",");
      results.add(`${h.realisedPnl}|${h.avgCost}|${ev}|${cg}`);
    }
    expect(results.size).toBe(1);
  });

  it("walks a same-timestamp buy before the sell", () => {
    const h = computeHoldings(reimport(ledger(), 7), {})[0]!;
    // buy first: avg (1000 + 1200) / 20 = 110 → sell 10 @150 realises 400, 10 left @110
    expect(h.realisedPnl.toString()).toBe("400");
    expect(h.avgCost!.toString()).toBe("110");
  });

  it("puts a split ahead of trades on its ex-date", () => {
    const out = sortLedger([
      trade("x", "buy", 5, 50, { rawRowHash: "a" }),
      tx({ id: "y", type: "split", price: "2", rawRowHash: "z" }),
    ]);
    expect(out.map((t) => t.type)).toEqual(["split", "buy"]);
  });

  it("orders real timestamps by time, never by type", () => {
    const out = sortLedger([
      trade("x", "buy", 1, 1, { tradeDate: "2024-01-02T09:30:00.000Z" }),
      trade("y", "sell", 1, 1, { tradeDate: "2024-01-02T09:15:00.000Z" }),
    ]);
    expect(out.map((t) => t.id)).toEqual(["y", "x"]);
  });

  it("breaks full ties by the broker's trade id, then the row fingerprint", () => {
    const out = sortLedger([
      trade("1", "buy", 1, 1, { rawRowHash: "b" }),
      trade("2", "buy", 1, 1, { externalRef: "T200" }),
      trade("3", "buy", 1, 1, { externalRef: "T100" }),
      trade("4", "buy", 1, 1, { rawRowHash: "a" }),
    ]);
    expect(out.map((t) => t.id)).toEqual(["3", "2", "4", "1"]);
  });
});
