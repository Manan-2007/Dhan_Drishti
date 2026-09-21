import { describe, it, expect } from "vitest";
import { computeHoldings } from "./holdings.js";
import { realisedEvents, rollupRealised } from "./performance.js";
import { ZERO } from "./money.js";
import type { CanonicalTx, TxType, Quote } from "./types.js";

let seq = 0;
function tx(p: Partial<CanonicalTx> & { type: TxType }): CanonicalTx {
  seq += 1;
  return {
    id: p.id ?? `s${String(seq).padStart(4, "0")}`,
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
    segment: p.segment ?? "fno",
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

const quoteAt = (price: string, prevClose?: string): Map<string, Quote> =>
  new Map([["SEC", { securityId: "SEC", price, prevClose: prevClose ?? null, currency: "INR", asOf: "2024-06-01T00:00:00Z" }]]);

describe("opening a short (selling what you don't hold)", () => {
  it("credits the proceeds as basis instead of booking them as profit", () => {
    const h = only([tx({ type: "sell", quantity: "100", price: "50" })]);
    expect(h.netQty.toString()).toBe("-100");
    expect(h.shortProceeds.toString()).toBe("5000");
    expect(h.realisedPnl.toString()).toBe("0"); // nothing is realised until it's covered
    expect(h.invested.toString()).toBe("0"); // no capital deployed on a short
  });

  it("reports the average price shorted at (positive), not a negative 'cost'", () => {
    const h = only([tx({ type: "sell", quantity: "100", price: "50" })]);
    expect(h.avgCost!.toString()).toBe("50");
  });

  it("deducts sell-side charges from the credit received", () => {
    const h = only([tx({ type: "sell", quantity: "100", price: "50", fees: "30", taxes: "20" })]);
    expect(h.shortProceeds.toString()).toBe("4950"); // 5000 − 30 − 20
  });

  it("still flags the position for review (could be a short, could be missing history)", () => {
    const h = only([tx({ type: "sell", quantity: "100", price: "50" })]);
    expect(h.hasOversell).toBe(true);
  });
});

describe("marking a short to market", () => {
  it("gains when the price falls", () => {
    const h = only([tx({ type: "sell", quantity: "100", price: "50" })], quoteAt("30"));
    expect(h.currentValue!.toString()).toBe("-3000"); // a liability: what it costs to buy back
    expect(h.unrealisedPnl!.toString()).toBe("2000"); // 5000 credit − 3000 buy-back
    expect(h.unrealisedPct!.toString()).toBe("0.4"); // against the 5000 credit received
  });

  it("loses when the price rises", () => {
    const h = only([tx({ type: "sell", quantity: "100", price: "50" })], quoteAt("70"));
    expect(h.currentValue!.toString()).toBe("-7000");
    expect(h.unrealisedPnl!.toString()).toBe("-2000");
  });

  it("moves today's change against the position when the price rises", () => {
    const h = only([tx({ type: "sell", quantity: "100", price: "50" })], quoteAt("60", "55"));
    expect(h.todayChange!.toString()).toBe("-500"); // -100 * (60 − 55)
  });

  it("folds the unrealised mark into net P&L", () => {
    const h = only([tx({ type: "sell", quantity: "100", price: "50" })], quoteAt("30"));
    expect(h.netPnl!.toString()).toBe("2000");
  });
});

describe("covering a short", () => {
  it("realises the gain on a full cover and leaves the position flat", () => {
    const h = only([
      tx({ type: "sell", quantity: "100", price: "50" }),
      tx({ type: "buy", quantity: "100", price: "30", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    expect(h.netQty.toString()).toBe("0");
    expect(h.realisedPnl.toString()).toBe("2000"); // shorted at 50, covered at 30
    expect(h.shortProceeds.toString()).toBe("0");
    expect(h.invested.toString()).toBe("0");
  });

  it("realises a loss when covering higher than the short price", () => {
    const h = only([
      tx({ type: "sell", quantity: "100", price: "50" }),
      tx({ type: "buy", quantity: "100", price: "65", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    expect(h.realisedPnl.toString()).toBe("-1500");
  });

  it("realises proportionally on a partial cover and keeps the rest short", () => {
    const h = only([
      tx({ type: "sell", quantity: "100", price: "50" }),
      tx({ type: "buy", quantity: "40", price: "30", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    expect(h.netQty.toString()).toBe("-60");
    expect(h.realisedPnl.toString()).toBe("800"); // 40 * (50 − 30)
    expect(h.shortProceeds.toString()).toBe("3000"); // 60 units still credited at 50
    expect(h.avgCost!.toString()).toBe("50");
  });

  it("charges cover-side fees against the realised result", () => {
    const h = only([
      tx({ type: "sell", quantity: "100", price: "50" }),
      tx({ type: "buy", quantity: "100", price: "30", fees: "100", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    expect(h.realisedPnl.toString()).toBe("1900"); // 2000 − 100 fees
  });
});

describe("flipping between long and short", () => {
  it("selling more than held closes the long and shorts the remainder", () => {
    const h = only([
      tx({ type: "buy", quantity: "10", price: "100" }),
      tx({ type: "sell", quantity: "30", price: "120", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    expect(h.netQty.toString()).toBe("-20");
    expect(h.realisedPnl.toString()).toBe("200"); // only the 10 long units: 10 * (120 − 100)
    expect(h.shortProceeds.toString()).toBe("2400"); // the other 20 units credited at 120
    expect(h.hasOversell).toBe(true);
  });

  it("buying more than the open short covers it and opens a long", () => {
    const h = only([
      tx({ type: "sell", quantity: "20", price: "120" }),
      tx({ type: "buy", quantity: "50", price: "100", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    expect(h.netQty.toString()).toBe("30");
    expect(h.realisedPnl.toString()).toBe("400"); // 20 * (120 − 100)
    expect(h.shortProceeds.toString()).toBe("0");
    expect(h.invested.toString()).toBe("3000"); // the 30 new long units at 100
    expect(h.avgCost!.toString()).toBe("100");
  });

  it("splits charges pro-rata across the covering and opening legs", () => {
    const h = only([
      tx({ type: "sell", quantity: "20", price: "120" }),
      tx({ type: "buy", quantity: "40", price: "100", fees: "80", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    // Half the buy covers (fees 40 charged to realised), half opens a long (fees 40 into cost).
    expect(h.realisedPnl.toString()).toBe("360"); // 20*(120−100) − 40
    expect(h.invested.toString()).toBe("2040"); // 20*100 + 40
  });
});

describe("realised P&L stays consistent between Holdings and Analytics", () => {
  const ledger = [
    tx({ type: "sell", quantity: "100", price: "50" }),
    tx({ type: "buy", quantity: "60", price: "30", tradeDate: "2024-02-01T00:00:00Z" }),
    tx({ type: "buy", quantity: "80", price: "20", tradeDate: "2024-03-01T00:00:00Z" }),
    tx({ type: "sell", quantity: "20", price: "35", tradeDate: "2024-04-01T00:00:00Z" }),
  ];

  it("the holdings engine and the realised-event walk agree", () => {
    const h = only(ledger);
    const summed = realisedEvents(ledger).reduce((acc, e) => acc.plus(e.realised), ZERO);
    expect(summed.toString()).toBe(h.realisedPnl.toString());
  });

  it("a covering buy produces a realised event (it isn't silently skipped)", () => {
    const events = realisedEvents([
      tx({ type: "sell", quantity: "100", price: "50" }),
      tx({ type: "buy", quantity: "100", price: "30", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]!.realised.toString()).toBe("2000");
    expect(events[0]!.date).toBe("2024-02-01T00:00:00Z"); // realised when covered, not when shorted
  });

  it("rolls the cover's P&L into the financial year it was covered in", () => {
    const roll = rollupRealised([
      tx({ type: "sell", quantity: "100", price: "50", tradeDate: "2024-03-01T00:00:00Z" }), // FY 23-24
      tx({ type: "buy", quantity: "100", price: "30", tradeDate: "2024-05-01T00:00:00Z" }), // FY 24-25
    ]);
    expect(roll.totalRealised.toString()).toBe("2000");
    expect(roll.byFY.find((f) => f.key === "FY 24-25")!.realised.toString()).toBe("2000");
    expect(roll.byFY.find((f) => f.key === "FY 23-24")).toBeUndefined(); // nothing realised at open
  });
});

describe("same-day round trips are order-independent", () => {
  // Broker exports carry a trade DATE but no intraday time, so same-day legs sort arbitrarily.
  // Matching a sell against a short (rather than booking its proceeds as profit) makes the
  // realised result identical either way — the ledger's arbitrary order can't change P&L.
  const buyFirst = [
    tx({ type: "buy", quantity: "50", price: "100", id: "a1" }),
    tx({ type: "sell", quantity: "50", price: "130", id: "a2" }),
  ];
  const sellFirst = [
    tx({ type: "sell", quantity: "50", price: "130", id: "b1" }),
    tx({ type: "buy", quantity: "50", price: "100", id: "b2" }),
  ];

  it("realises the same P&L whichever leg is processed first", () => {
    expect(only(buyFirst).realisedPnl.toString()).toBe("1500");
    expect(only(sellFirst).realisedPnl.toString()).toBe("1500");
  });

  it("leaves a flat position either way", () => {
    expect(only(buyFirst).netQty.toString()).toBe("0");
    expect(only(sellFirst).netQty.toString()).toBe("0");
  });
});

describe("corporate actions on a short", () => {
  it("a split scales the owed quantity but not the credit received", () => {
    const h = only([
      tx({ type: "sell", quantity: "100", price: "50" }),
      tx({ type: "split", price: "2", tradeDate: "2024-02-01T00:00:00Z" }),
    ]);
    expect(h.netQty.toString()).toBe("-200");
    expect(h.shortProceeds.toString()).toBe("5000"); // total credit unchanged
    expect(h.avgCost!.toString()).toBe("25"); // per-unit basis halves with the split
  });
});
