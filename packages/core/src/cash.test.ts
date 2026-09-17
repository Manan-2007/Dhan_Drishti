import { describe, it, expect } from "vitest";
import { cashDeltas, cashBalances, cashBalanceAsOf, hasCashAccounting } from "./cash.js";
import type { CanonicalTx, TxType } from "./types.js";

let seq = 0;
function tx(p: Partial<CanonicalTx> & { type: TxType }): CanonicalTx {
  seq += 1;
  return {
    id: `t${String(seq).padStart(4, "0")}`,
    userId: "u1",
    portfolioId: "p1",
    accountId: null,
    securityId: "securityId" in p ? p.securityId : "SEC",
    type: p.type,
    tradeDate: p.tradeDate ?? "2024-01-01T00:00:00Z",
    settleDate: null,
    quantity: p.quantity ?? "0",
    price: p.price ?? "0",
    grossAmount: p.grossAmount ?? "0",
    fees: p.fees ?? "0",
    taxes: p.taxes ?? "0",
    currency: p.currency ?? "INR",
    fxRateToBase: null,
    segment: p.segment ?? "equity",
    externalRef: null,
    rawRowHash: null,
    sourceBroker: null,
    notes: null,
  };
}

describe("cash-balance engine", () => {
  it("tracks deposits, trades, income and charges", () => {
    const txs = [
      tx({ type: "deposit", securityId: null, grossAmount: "100000", tradeDate: "2024-01-01T00:00:00Z" }),
      tx({ type: "buy", quantity: "10", price: "5000", fees: "50", tradeDate: "2024-01-05T00:00:00Z" }),
      tx({ type: "dividend", grossAmount: "800", tradeDate: "2024-03-01T00:00:00Z" }),
      tx({ type: "sell", quantity: "4", price: "6000", fees: "30", tradeDate: "2024-04-01T00:00:00Z" }),
      tx({ type: "withdrawal", securityId: null, grossAmount: "20000", tradeDate: "2024-05-01T00:00:00Z" }),
    ];
    // 100000 − (50000+50) + 800 + (24000−30) − 20000 = 54720
    expect(cashBalances(txs).get("INR")!.toString()).toBe("54720");
    expect(hasCashAccounting(txs)).toBe(true);
  });

  it("gives cash as of a date (dividends retained)", () => {
    const txs = [
      tx({ type: "deposit", securityId: null, grossAmount: "50000", tradeDate: "2024-01-01T00:00:00Z" }),
      tx({ type: "buy", quantity: "10", price: "1000", tradeDate: "2024-02-01T00:00:00Z" }),
      tx({ type: "dividend", grossAmount: "500", tradeDate: "2024-06-01T00:00:00Z" }),
    ];
    const deltas = cashDeltas(txs);
    expect(cashBalanceAsOf(deltas, "INR", "2024-03-01").toString()).toBe("40000"); // before the dividend
    expect(cashBalanceAsOf(deltas, "INR", "2024-06-30").toString()).toBe("40500"); // dividend retained as cash
  });

  it("separates cash by currency and ignores stock-only events", () => {
    const txs = [
      tx({ type: "deposit", securityId: null, grossAmount: "1000", currency: "USD" }),
      tx({ type: "bonus", quantity: "5" }),
      tx({ type: "split", price: "2" }),
    ];
    const bal = cashBalances(txs);
    expect(bal.get("USD")!.toString()).toBe("1000");
    expect(bal.has("INR")).toBe(false); // bonus/split move no cash
  });

  it("reports no cash accounting when there are no deposits/withdrawals", () => {
    expect(hasCashAccounting([tx({ type: "buy", quantity: "1", price: "100" })])).toBe(false);
  });
});
