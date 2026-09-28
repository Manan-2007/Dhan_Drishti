import { describe, it, expect } from "vitest";
import { computeHoldings } from "./holdings.js";
import { realisedEvents, withoutUnmatchedSales } from "./performance.js";
import { fifoCapitalGains } from "./tax.js";
import type { CanonicalTx, Segment } from "./types.js";

// Delivery shares can't be short overnight: a sale with nothing held, still open at day's end,
// sold shares bought before the imported history.

let seq = 0;
function trade(type: "buy" | "sell", qty: number, price: number, tradeDate: string, segment: Segment = "equity"): CanonicalTx {
  seq += 1;
  return {
    id: `d${String(seq).padStart(4, "0")}`,
    userId: "u1",
    portfolioId: "p1",
    accountId: null,
    securityId: "SEC",
    type,
    tradeDate,
    settleDate: null,
    quantity: String(qty),
    price: String(price),
    grossAmount: String(qty * price),
    fees: "0",
    taxes: "0",
    currency: "INR",
    fxRateToBase: null,
    segment,
    externalRef: null,
    rawRowHash: `r${seq}`,
    sourceBroker: null,
    notes: null,
  };
}

const realisedSum = (txs: CanonicalTx[]) => realisedEvents(txs).reduce((s, e) => s + Number(e.realised), 0);
const gains = (txs: CanonicalTx[]) => fifoCapitalGains(txs, { longTermDays: () => 365 });

describe("sold before the history starts", () => {
  const txs = () => [trade("sell", 50, 100, "2024-05-01T00:00:00.000Z"), trade("buy", 50, 90, "2024-06-01T00:00:00.000Z")];

  it("isn't a short: the later purchase is a new holding, and no profit is invented", () => {
    const h = computeHoldings(txs(), {})[0]!;
    expect(h.netQty.toString()).toBe("50");
    expect(h.invested.toString()).toBe("4500");
    expect(h.realisedPnl.toString()).toBe("0");
    expect(h.soldWithoutPurchase.toString()).toBe("50");
    expect(h.soldWithoutPurchaseProceeds.toString()).toBe("5000");
    expect(h.hasOversell).toBe(true);
  });

  it("agrees across the realised walk, the FIFO tax walk and money-weighted returns", () => {
    expect(realisedSum(txs())).toBe(0);
    const later = [...txs(), trade("sell", 20, 120, "2024-07-01T00:00:00.000Z")];
    expect(gains(later).map((g) => [g.buyDate, g.quantity, g.gain])).toEqual([["2024-06-01", "20", "600"]]);
    expect(withoutUnmatchedSales(txs()).map((t) => t.type)).toEqual(["buy"]); // the unmatched sale drops out
  });
});

describe("an intraday short in shares", () => {
  const txs = () => [trade("sell", 10, 110, "2024-05-01T04:00:00.000Z"), trade("buy", 10, 100, "2024-05-01T08:00:00.000Z")];

  it("is covered the same day and realises normally", () => {
    const h = computeHoldings(txs(), {})[0]!;
    expect(h.netQty.toString()).toBe("0");
    expect(h.realisedPnl.toString()).toBe("100");
    expect(h.soldWithoutPurchase.toString()).toBe("0");
    expect(realisedSum(txs())).toBe(100);
    expect(withoutUnmatchedSales(txs())).toHaveLength(2);
  });

  it("leaves no phantom tax lot behind", () => {
    const later = [...txs(), trade("buy", 5, 105, "2024-05-02T00:00:00.000Z"), trade("sell", 5, 120, "2024-05-03T00:00:00.000Z")];
    expect(gains(later).map((g) => [g.buyDate, g.quantity, g.gain])).toEqual([["2024-05-02", "5", "75"]]);
  });
});

describe("an F&O short", () => {
  it("stays a real short overnight", () => {
    const h = computeHoldings([trade("sell", 50, 100, "2024-05-01T00:00:00.000Z", "fno")], {})[0]!;
    expect(h.netQty.toString()).toBe("-50");
    expect(h.soldWithoutPurchase.toString()).toBe("0");
  });
});
