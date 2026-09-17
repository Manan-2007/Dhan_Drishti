import { describe, it, expect } from "vitest";
import { computeHoldings } from "./holdings.js";
import type { CanonicalTx, TxType, Quote } from "./types.js";

let seq = 0;
function tx(p: Partial<CanonicalTx> & { type: TxType }): CanonicalTx {
  seq += 1;
  return {
    id: p.id ?? `t${String(seq).padStart(4, "0")}`,
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
    fxRateToBase: "fxRateToBase" in p ? p.fxRateToBase : null,
    segment: p.segment ?? "equity",
    externalRef: null,
    rawRowHash: null,
    sourceBroker: null,
    notes: null,
  };
}

function only(txs: CanonicalTx[], quotes?: Map<string, Quote>) {
  const h = computeHoldings(txs, quotes ? { quotes } : {});
  expect(h).toHaveLength(1);
  return h[0]!;
}

describe("computeHoldings — average cost", () => {
  it("single buy", () => {
    const h = only([tx({ type: "buy", quantity: "10", price: "100" })]);
    expect(h.netQty.toString()).toBe("10");
    expect(h.invested.toString()).toBe("1000");
    expect(h.avgCost!.toString()).toBe("100");
    expect(h.currentValue).toBeNull(); // no quote → unknown, not 0
    expect(h.netPnl).toBeNull();
  });

  it("two buys average correctly", () => {
    const h = only([
      tx({ type: "buy", quantity: "10", price: "100", tradeDate: "2024-01-01T00:00:00Z" }),
      tx({ type: "buy", quantity: "10", price: "200", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    expect(h.netQty.toString()).toBe("20");
    expect(h.invested.toString()).toBe("3000");
    expect(h.avgCost!.toString()).toBe("150");
  });

  it("partial sell realises P&L at average cost and keeps remaining basis", () => {
    const h = only([
      tx({ type: "buy", quantity: "10", price: "100", tradeDate: "2024-01-01T00:00:00Z" }),
      tx({ type: "buy", quantity: "10", price: "200", tradeDate: "2024-02-01T00:00:00Z" }),
      tx({ type: "sell", quantity: "5", price: "300", tradeDate: "2024-03-01T00:00:00Z" }),
    ]);
    // avg cost 150; sell 5 @ 300 → realised = 5*(300-150) = 750
    expect(h.realisedPnl.toString()).toBe("750");
    expect(h.netQty.toString()).toBe("15");
    expect(h.invested.toString()).toBe("2250"); // 15 * 150
    expect(h.avgCost!.toString()).toBe("150");
  });

  it("sell everything zeroes qty and basis", () => {
    const h = only([
      tx({ type: "buy", quantity: "10", price: "100" }),
      tx({ type: "sell", quantity: "10", price: "120", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    expect(h.netQty.toString()).toBe("0");
    expect(h.invested.toString()).toBe("0");
    expect(h.avgCost).toBeNull();
    expect(h.realisedPnl.toString()).toBe("200"); // 10*(120-100)
  });

  it("fees included in cost basis on buy and subtracted on sell", () => {
    const h = only([
      tx({ type: "buy", quantity: "10", price: "100", fees: "20" }),
      tx({ type: "sell", quantity: "10", price: "120", fees: "15", taxes: "5", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    // basis = 1000 + 20 = 1020; proceeds 1200; realised = 1200 - 1020 - 15 - 5 = 160
    expect(h.realisedPnl.toString()).toBe("160");
    expect(h.feesTotal.toString()).toBe("35");
    expect(h.taxesTotal.toString()).toBe("5");
  });

  it("dividends accumulate and do not affect qty", () => {
    const h = only([
      tx({ type: "buy", quantity: "100", price: "50" }),
      tx({ type: "dividend", grossAmount: "250", tradeDate: "2024-06-01T00:00:00Z" }),
    ]);
    expect(h.netQty.toString()).toBe("100");
    expect(h.dividends.toString()).toBe("250");
  });

  it("bonus shares lower the average cost", () => {
    const h = only([
      tx({ type: "buy", quantity: "10", price: "100" }),
      tx({ type: "bonus", quantity: "10", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    expect(h.netQty.toString()).toBe("20");
    expect(h.invested.toString()).toBe("1000");
    expect(h.avgCost!.toString()).toBe("50");
  });

  it("stock split scales quantity by the ratio and preserves total cost", () => {
    // 1:5 split — `price` carries the ratio (new shares per old share).
    const h = only([
      tx({ type: "buy", quantity: "10", price: "1000" }),
      tx({ type: "split", price: "5", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    expect(h.netQty.toString()).toBe("50"); // 10 × 5
    expect(h.invested.toString()).toBe("10000"); // unchanged
    expect(h.avgCost!.toString()).toBe("200"); // 1000 → 200
  });

  it("reverse split (consolidation) with a fractional ratio shrinks quantity", () => {
    const h = only([
      tx({ type: "buy", quantity: "100", price: "10" }),
      tx({ type: "split", price: "0.1", tradeDate: "2024-02-01T00:00:00Z" }), // 10:1 consolidation
    ]);
    expect(h.netQty.toString()).toBe("10");
    expect(h.invested.toString()).toBe("1000");
    expect(h.avgCost!.toString()).toBe("100");
  });

  it("tracks base-currency cost at the FX rate of each buy (for return decomposition)", () => {
    // Two USD buys at different USD→INR rates; base cost sums at each buy's rate.
    const h = only([
      tx({ type: "buy", quantity: "10", price: "100", currency: "USD", fxRateToBase: "80" }),
      tx({ type: "buy", quantity: "10", price: "100", currency: "USD", fxRateToBase: "90", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    expect(h.invested.toString()).toBe("2000"); // local (USD)
    expect(h.investedBaseAtCost!.toString()).toBe("170000"); // 1000*80 + 1000*90
    expect(h.avgFxAtCost!.toString()).toBe("85"); // 170000 / 2000
  });

  it("leaves FX-at-cost null when any contributing buy lacks a rate", () => {
    const h = only([
      tx({ type: "buy", quantity: "10", price: "100", currency: "USD", fxRateToBase: "80" }),
      tx({ type: "buy", quantity: "10", price: "100", currency: "USD", tradeDate: "2024-02-01T00:00:00Z" }), // no rate
    ]);
    expect(h.investedBaseAtCost).toBeNull();
    expect(h.avgFxAtCost).toBeNull();
  });

  it("reduces base cost proportionally on a partial sell, preserving avg FX-at-cost", () => {
    const h = only([
      tx({ type: "buy", quantity: "10", price: "100", currency: "USD", fxRateToBase: "80" }),
      tx({ type: "sell", quantity: "4", price: "120", currency: "USD", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    expect(h.netQty.toString()).toBe("6");
    expect(h.investedBaseAtCost!.toString()).toBe("48000"); // 6/10 of 80000
    expect(h.avgFxAtCost!.toString()).toBe("80");
  });

  it("oversell is flagged, not silently wrong", () => {
    const h = only([
      tx({ type: "buy", quantity: "5", price: "100" }),
      tx({ type: "sell", quantity: "10", price: "120", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    expect(h.hasOversell).toBe(true);
  });
});

describe("computeHoldings — with quotes", () => {
  it("computes current value, unrealised, today change and net P&L", () => {
    const quotes = new Map<string, Quote>([
      ["SEC", { securityId: "SEC", price: "150", prevClose: "140", currency: "INR", asOf: "2024-04-01T00:00:00Z" }],
    ]);
    const h = only(
      [
        tx({ type: "buy", quantity: "10", price: "100" }),
        tx({ type: "dividend", grossAmount: "50", tradeDate: "2024-03-01T00:00:00Z" }),
      ],
      quotes,
    );
    expect(h.currentValue!.toString()).toBe("1500");
    expect(h.unrealisedPnl!.toString()).toBe("500"); // 1500 - 1000
    expect(h.unrealisedPct!.toString()).toBe("0.5");
    expect(h.todayChange!.toString()).toBe("100"); // 10*(150-140)
    expect(h.netPnl!.toString()).toBe("550"); // 500 unreal + 0 realised + 50 div
  });
});

describe("computeHoldings — multi-security & cash", () => {
  it("separates securities and ignores pure-cash transactions", () => {
    const h = computeHoldings([
      tx({ type: "buy", securityId: "A", quantity: "10", price: "100" }),
      tx({ type: "buy", securityId: "B", quantity: "5", price: "200" }),
      tx({ type: "deposit", securityId: null, grossAmount: "100000" }),
    ]);
    expect(h).toHaveLength(2);
    expect(h.find((x) => x.securityId === "A")!.invested.toString()).toBe("1000");
    expect(h.find((x) => x.securityId === "B")!.invested.toString()).toBe("1000");
  });
});
