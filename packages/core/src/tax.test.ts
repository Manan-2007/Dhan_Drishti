import { describe, it, expect } from "vitest";
import { fifoCapitalGains } from "./tax.js";
import type { CanonicalTx, TxType } from "./types.js";

let seq = 0;
function tx(p: Partial<CanonicalTx> & { type: TxType }): CanonicalTx {
  seq += 1;
  return {
    id: p.id ?? `t${String(seq).padStart(4, "0")}`,
    userId: "u1",
    portfolioId: "p1",
    accountId: null,
    securityId: p.securityId ?? "s1",
    type: p.type,
    tradeDate: p.tradeDate ?? "2023-01-01",
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

const opts = { longTermDays: () => 365 };

describe("fifoCapitalGains", () => {
  it("classifies a >12-month hold as long-term with the right gain", () => {
    const rows = fifoCapitalGains(
      [tx({ type: "buy", quantity: "100", price: "10", tradeDate: "2022-01-01" }), tx({ type: "sell", quantity: "100", price: "20", tradeDate: "2023-06-01" })],
      opts,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.term).toBe("long");
    expect(rows[0]!.proceeds).toBe("2000");
    expect(rows[0]!.cost).toBe("1000");
    expect(rows[0]!.gain).toBe("1000");
    expect(rows[0]!.buyDate).toBe("2022-01-01");
    expect(rows[0]!.sellDate).toBe("2023-06-01");
  });

  it("matches sales against the oldest lots first (FIFO)", () => {
    const rows = fifoCapitalGains(
      [
        tx({ type: "buy", quantity: "10", price: "100", tradeDate: "2023-01-01" }),
        tx({ type: "buy", quantity: "10", price: "120", tradeDate: "2023-02-01" }),
        tx({ type: "sell", quantity: "15", price: "150", tradeDate: "2023-03-01" }),
      ],
      opts,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.quantity).toBe("10");
    expect(rows[0]!.gain).toBe("500"); // 10@150 vs 10@100
    expect(rows[1]!.quantity).toBe("5");
    expect(rows[1]!.gain).toBe("150"); // 5@150 vs 5@120
    expect(rows.every((r) => r.term === "short")).toBe(true);
  });

  it("folds buy fees into cost and pro-rates sell fees", () => {
    const rows = fifoCapitalGains(
      [tx({ type: "buy", quantity: "10", price: "100", fees: "50", tradeDate: "2023-01-01" }), tx({ type: "sell", quantity: "10", price: "150", taxes: "30", tradeDate: "2023-02-01" })],
      opts,
    );
    expect(rows[0]!.cost).toBe("1050"); // 1000 + 50 buy fee
    expect(rows[0]!.proceeds).toBe("1470"); // 1500 − 30 sell tax
    expect(rows[0]!.gain).toBe("420");
  });

  it("treats bonus shares as zero-cost lots", () => {
    const rows = fifoCapitalGains(
      [tx({ type: "buy", quantity: "10", price: "100", tradeDate: "2023-01-01" }), tx({ type: "bonus", quantity: "10", tradeDate: "2023-02-01" }), tx({ type: "sell", quantity: "20", price: "150", tradeDate: "2023-03-01" })],
      opts,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.gain).toBe("500"); // original lot
    expect(rows[1]!.cost).toBe("0"); // bonus lot has no cost
    expect(rows[1]!.gain).toBe("1500");
  });

  it("scales lots on a split without changing the cost basis", () => {
    const rows = fifoCapitalGains(
      [tx({ type: "buy", quantity: "10", price: "100", tradeDate: "2023-01-01" }), tx({ type: "split", price: "2", tradeDate: "2023-02-01" }), tx({ type: "sell", quantity: "20", price: "60", tradeDate: "2023-03-01" })],
      opts,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quantity).toBe("20");
    expect(rows[0]!.cost).toBe("1000"); // basis unchanged by the split
    expect(rows[0]!.gain).toBe("200"); // 20@60 − 1000
  });

  it("excludes F&O trades (business income, not capital gains)", () => {
    const rows = fifoCapitalGains(
      [tx({ type: "buy", quantity: "50", price: "100", segment: "fno", tradeDate: "2023-01-01" }), tx({ type: "sell", quantity: "50", price: "120", segment: "fno", tradeDate: "2023-02-01" })],
      opts,
    );
    expect(rows).toHaveLength(0);
  });
});
