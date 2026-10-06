import { describe, it, expect } from "vitest";
import { parseFundamentals } from "../src/market/providers/yahoo-fundamentals.js";

/** A trimmed, representative quoteSummary result (the shape Yahoo returns). */
const result = {
  price: { currency: { raw: "INR" }, marketCap: { raw: 1_600_000_000_000 } },
  summaryDetail: {
    marketCap: { raw: 1_650_000_000_000 },
    trailingPE: { raw: 24.5 },
    forwardPE: { raw: 21.1 },
    dividendYield: { raw: 0.0043 },
    fiftyTwoWeekLow: { raw: 1114.85 },
    fiftyTwoWeekHigh: { raw: 1608.95 },
    dayLow: { raw: 1180.1 },
    dayHigh: { raw: 1199.4 },
  },
  defaultKeyStatistics: {
    priceToBook: { raw: 2.1 },
    pegRatio: { raw: 1.8 },
    trailingEps: { raw: 48.3 },
    bookValue: { raw: 565.2 },
  },
  financialData: {
    profitMargins: { raw: 0.082 },
    operatingMargins: { raw: 0.14 },
    revenueGrowth: { raw: 0.072 },
    earningsGrowth: { raw: -0.031 },
    returnOnEquity: { raw: 0.088 },
    targetMeanPrice: { raw: 1450.5 },
    recommendationKey: { raw: "buy" },
    numberOfAnalystOpinions: { raw: 34 },
  },
};

describe("parseFundamentals", () => {
  it("flattens the quoteSummary modules into our shape", () => {
    const f = parseFundamentals(result, "2026-10-06T00:00:00.000Z");
    expect(f.currency).toBe("INR");
    expect(f.marketCap).toBe(1_650_000_000_000); // summaryDetail wins over price
    expect(f.trailingPE).toBe(24.5);
    expect(f.forwardPE).toBe(21.1);
    expect(f.priceToBook).toBe(2.1);
    expect(f.pegRatio).toBe(1.8);
    expect(f.profitMargin).toBe(0.082);
    expect(f.operatingMargin).toBe(0.14);
    expect(f.revenueGrowth).toBe(0.072);
    expect(f.earningsGrowth).toBe(-0.031);
    expect(f.returnOnEquity).toBe(0.088);
    expect(f.dividendYield).toBe(0.0043);
    expect(f.eps).toBe(48.3);
    expect(f.fiftyTwoWeekLow).toBe(1114.85);
    expect(f.fiftyTwoWeekHigh).toBe(1608.95);
    expect(f.targetMeanPrice).toBe(1450.5);
    expect(f.recommendationKey).toBe("buy");
    expect(f.numberOfAnalysts).toBe(34);
    expect(f.asOf).toBe("2026-10-06T00:00:00.000Z");
  });

  it("returns nulls for missing modules/fields rather than throwing or guessing", () => {
    const f = parseFundamentals({ summaryDetail: { trailingPE: { raw: 15 } } });
    expect(f.trailingPE).toBe(15);
    expect(f.marketCap).toBeNull();
    expect(f.pegRatio).toBeNull();
    expect(f.recommendationKey).toBeNull();
    expect(f.currency).toBeNull();
  });

  it("ignores non-finite or wrong-typed raws", () => {
    const f = parseFundamentals({ summaryDetail: { trailingPE: { raw: "n/a" }, marketCap: { raw: Infinity } } } as Record<string, unknown>);
    expect(f.trailingPE).toBeNull();
    expect(f.marketCap).toBeNull();
  });
});
