import { describe, it, expect } from "vitest";
import { realisedEvents, rollupRealised, financialYear, xirr, ledgerCashflows, priceAsOf, simulateBenchmark, benchmarkSeries, linkedTwr } from "./performance.js";
import type { CanonicalTx, TxType } from "./types.js";

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
    currency: "INR",
    fxRateToBase: null,
    segment: p.segment ?? "equity",
    externalRef: null,
    rawRowHash: null,
    sourceBroker: null,
    notes: null,
  };
}

describe("financialYear (Indian, Apr–Mar)", () => {
  it("maps months to the right FY", () => {
    expect(financialYear("2024-04-01T00:00:00Z")).toBe("FY 24-25");
    expect(financialYear("2024-03-31T00:00:00Z")).toBe("FY 23-24");
    expect(financialYear("2025-01-15T00:00:00Z")).toBe("FY 24-25");
  });
});

describe("realisedEvents", () => {
  it("emits one event per sell at average cost", () => {
    const evs = realisedEvents([
      tx({ type: "buy", quantity: "10", price: "100", tradeDate: "2024-01-01T00:00:00Z" }),
      tx({ type: "buy", quantity: "10", price: "200", tradeDate: "2024-02-01T00:00:00Z" }),
      tx({ type: "sell", quantity: "5", price: "300", tradeDate: "2024-03-01T00:00:00Z" }),
    ]);
    expect(evs).toHaveLength(1);
    expect(evs[0]!.realised.toString()).toBe("750"); // 5*(300-150)
  });
});

describe("realisedEvents — corporate actions", () => {
  it("a split before a sell realises at the split-adjusted average cost", () => {
    const evs = realisedEvents([
      tx({ type: "buy", quantity: "10", price: "1000", tradeDate: "2024-01-01T00:00:00Z" }),
      tx({ type: "split", price: "5", tradeDate: "2024-02-01T00:00:00Z" }), // 1:5 → 50 sh @ 200
      tx({ type: "sell", quantity: "25", price: "250", tradeDate: "2024-03-01T00:00:00Z" }),
    ]);
    expect(evs).toHaveLength(1);
    expect(evs[0]!.realised.toString()).toBe("1250"); // 25*(250-200)
  });
});

describe("rollupRealised", () => {
  it("aggregates realised by FY, month, segment and dividends", () => {
    const r = rollupRealised([
      tx({ type: "buy", quantity: "10", price: "100", tradeDate: "2023-05-01T00:00:00Z" }),
      tx({ type: "sell", quantity: "10", price: "150", tradeDate: "2023-06-01T00:00:00Z", segment: "equity" }),
      tx({ type: "dividend", grossAmount: "200", tradeDate: "2023-09-01T00:00:00Z" }),
      tx({ type: "buy", quantity: "5", price: "100", tradeDate: "2024-05-01T00:00:00Z", securityId: "B" }),
      tx({ type: "sell", quantity: "5", price: "80", tradeDate: "2024-06-01T00:00:00Z", securityId: "B", segment: "fno" }),
    ]);
    expect(r.totalRealised.toString()).toBe("400"); // 500 + (-100)
    expect(r.totalDividends.toString()).toBe("200");
    const fy2324 = r.byFY.find((x) => x.key === "FY 23-24")!;
    expect(fy2324.realised.toString()).toBe("500");
    expect(fy2324.dividends.toString()).toBe("200");
    const fno = r.bySegment.find((x) => x.key === "fno")!;
    expect(fno.realised.toString()).toBe("-100");
    expect(r.byMonth.find((m) => m.key === "2023-06")!.realised.toString()).toBe("500");
  });
});

describe("xirr", () => {
  it("returns null without both an inflow and outflow", () => {
    expect(xirr([{ date: "2024-01-01", amount: -100 }])).toBeNull();
    expect(xirr([{ date: "2024-01-01", amount: -100 }, { date: "2024-06-01", amount: -50 }])).toBeNull();
  });

  it("computes ~100% for doubling in one year", () => {
    const r = xirr([
      { date: "2023-01-01", amount: -100 },
      { date: "2024-01-01", amount: 200 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0.98);
    expect(r!).toBeLessThan(1.02);
  });

  it("computes ~0% when value is unchanged", () => {
    const r = xirr([
      { date: "2023-01-01", amount: -100 },
      { date: "2024-01-01", amount: 100 },
    ]);
    expect(Math.abs(r!)).toBeLessThan(0.01);
  });

  it("builds ledger cashflows with correct signs", () => {
    const flows = ledgerCashflows([
      tx({ type: "buy", quantity: "10", price: "100", fees: "10", tradeDate: "2023-01-01T00:00:00Z" }),
      tx({ type: "sell", quantity: "10", price: "150", fees: "5", tradeDate: "2024-01-01T00:00:00Z" }),
      tx({ type: "dividend", grossAmount: "50", tradeDate: "2023-06-01T00:00:00Z" }),
    ]);
    expect(flows[0]!.amount).toBe(-1010); // -(1000+10)
    expect(flows[1]!.amount).toBe(1495); // 1500-5
    expect(flows[2]!.amount).toBe(50);
  });
});

describe("priceAsOf", () => {
  const bars = [
    { date: "2024-01-01", close: 100 },
    { date: "2024-01-05", close: 110 },
    { date: "2024-01-10", close: 120 },
  ];
  it("returns the close on an exact match", () => {
    expect(priceAsOf(bars, "2024-01-05")).toBe(110);
  });
  it("falls back to the most recent earlier bar (weekend/holiday)", () => {
    expect(priceAsOf(bars, "2024-01-07")).toBe(110);
  });
  it("returns null before any data exists", () => {
    expect(priceAsOf(bars, "2023-12-31")).toBeNull();
  });
});

describe("simulateBenchmark (index-equivalent mirror)", () => {
  const bars = [
    { date: "2023-01-01", close: 100 },
    { date: "2024-01-01", close: 200 }, // index doubled over the year
  ];

  it("buys units at each outflow and values them at the latest close", () => {
    // One ₹1000 buy when the index was 100 → 10 units → worth 10*200 = 2000.
    const r = simulateBenchmark([{ date: "2023-01-01", amount: -1000 }], bars, 200);
    expect(r.units).toBe(10);
    expect(r.investedNet).toBe(1000);
    expect(r.currentValue).toBe(2000);
    expect(r.gain).toBe(1000);
    expect(r.matchedFlows).toBe(1);
    expect(r.unmatchedFlows).toBe(0);
    // Units are valued as of now (terminal = today), so the rate depends on wall-clock;
    // assert only that a 2× gain yields a positive money-weighted return.
    expect(r.xirr).not.toBeNull();
    expect(r.xirr!).toBeGreaterThan(0);
  });

  it("skips (and counts) cashflows that predate the index data", () => {
    const r = simulateBenchmark(
      [
        { date: "2022-06-01", amount: -500 }, // before any bar → skipped
        { date: "2023-01-01", amount: -1000 },
      ],
      bars,
      200,
    );
    expect(r.unmatchedFlows).toBe(1);
    expect(r.matchedFlows).toBe(1);
    expect(r.investedNet).toBe(1000); // only the matched flow counts
    expect(r.units).toBe(10);
  });

  it("sells index units on an inflow (cash out mirrors the index too)", () => {
    const r = simulateBenchmark(
      [
        { date: "2023-01-01", amount: -1000 }, // buy 10 units @100
        { date: "2024-01-01", amount: 400 }, // sell 2 units @200
      ],
      bars,
      200,
    );
    expect(r.units).toBe(8); // 10 - 2
    expect(r.currentValue).toBe(1600); // 8 * 200
  });
});

describe("benchmarkSeries (overlay points)", () => {
  const bars = [
    { date: "2023-01-01", close: 100 },
    { date: "2023-06-30", close: 150 },
    { date: "2024-01-01", close: 200 },
  ];

  it("starts at the first flow and tracks invested vs the index units' value", () => {
    const pts = benchmarkSeries([{ date: "2023-01-01", amount: -1000 }], bars);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    // First point is the first flow date: contributed = index value (bought at that close).
    expect(pts[0]!.date).toBe("2023-01-01");
    expect(pts[0]!.invested).toBe(1000);
    expect(pts[0]!.index).toBe(1000);
    // A mid sample at/after 2023-06-30 values 10 units @150 = 1500 while invested stays 1000.
    const mid = pts.find((p) => p.date >= "2023-06-30" && p.date < "2024-01-01");
    expect(mid).toBeTruthy();
    expect(mid!.invested).toBe(1000);
    expect(mid!.index).toBeCloseTo(1500, 6);
  });

  it("returns nothing without cashflows or bars", () => {
    expect(benchmarkSeries([], bars)).toEqual([]);
    expect(benchmarkSeries([{ date: "2023-01-01", amount: -1000 }], [])).toEqual([]);
  });

  it("excludes flows that predate the index data from the contributed line", () => {
    const pts = benchmarkSeries(
      [
        { date: "2022-06-01", amount: -500 }, // before any bar → skipped
        { date: "2023-01-01", amount: -1000 },
      ],
      bars,
    );
    // First matched flow is 2023-01-01; the pre-index flow never adds to invested.
    const last = pts[pts.length - 1]!;
    expect(last.invested).toBe(1000);
  });
});

describe("linkedTwr (time-weighted return)", () => {
  it("chains sub-period growth, stripping out contribution timing", () => {
    // Invest 100 (value 0 before) → grows to 150; add 100 (now 250) → grows to 300.
    const r = linkedTwr([
      { date: "2023-01-01", value: 0, flow: 100 },
      { date: "2023-07-01", value: 150, flow: 100 },
      { date: "2024-01-01", value: 300, flow: 0 },
    ]);
    // 1.5 × 1.2 = 1.8 → 80% over exactly one year.
    expect(r.subPeriods).toBe(2);
    expect(r.twr).toBeCloseTo(0.8, 6);
    expect(r.annualized).toBeCloseTo(0.8, 3);
  });

  it("is unaffected by when money was added (unlike XIRR)", () => {
    // Same underlying asset path, different contribution sizes/timing → same TWR.
    const a = linkedTwr([
      { date: "2023-01-01", value: 0, flow: 1000 },
      { date: "2023-07-01", value: 1100, flow: 5000 },
      { date: "2024-01-01", value: 6710, flow: 0 },
    ]);
    // period1 1100/1000 = 1.1 ; period2 6710/6100 = 1.1 → 1.21 → 21%
    expect(a.twr).toBeCloseTo(0.21, 6);
  });

  it("returns null when there is no valued sub-period", () => {
    expect(linkedTwr([{ date: "2023-01-01", value: 0, flow: 100 }]).twr).toBeNull();
  });
});
