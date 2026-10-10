import { describe, it, expect } from "vitest";
import { createDb } from "../src/db/index.js";
import { parseAmount } from "../src/market/providers/nasdaq-fundamentals.js";
import { CachedFundamentals } from "../src/market/providers/fundamentals.js";
import type { Fundamentals, FundamentalsProvider } from "../src/market/providers/yahoo-fundamentals.js";

const blank: Fundamentals = {
  currency: "USD", marketCap: null, trailingPE: null, forwardPE: null, priceToBook: null, pegRatio: null, profitMargin: null, operatingMargin: null,
  revenueGrowth: null, earningsGrowth: null, returnOnEquity: null, dividendYield: null, eps: null, bookValue: null, fiftyTwoWeekLow: null,
  fiftyTwoWeekHigh: null, dayLow: null, dayHigh: null, targetMeanPrice: null, recommendationKey: null, numberOfAnalysts: null, asOf: "2026-10-11T00:00:00Z",
};
const fake = (f: Partial<Fundamentals> | null) => {
  const p = { calls: 0, async getFundamentals() { p.calls++; return f ? { ...blank, ...f } : null; } };
  return p as FundamentalsProvider & { calls: number };
};

describe("fundamentals sources", () => {
  it("reads Nasdaq's money columns", () => {
    expect(parseAmount("$96,222,000")).toBe(96222000);
    expect(parseAmount("-$102,000")).toBe(-102000);
    expect(parseAmount("--")).toBeNull();
    expect(parseAmount("N/A")).toBeNull();
  });

  it("takes Nasdaq for a US stock, lets Yahoo fill only the gaps, and keeps it through a restart", async () => {
    const { db } = await createDb(":memory:");
    const nasdaq = fake({ trailingPE: 28.6, marketCap: 5e12, source: "Nasdaq" });
    const yahoo = fake({ trailingPE: 99, forwardPE: 24.1, source: "Yahoo" });
    const f = await new CachedFundamentals(db, nasdaq, yahoo).getFundamentals("NVDA");
    expect(f).toMatchObject({ trailingPE: 28.6, forwardPE: 24.1, source: "Nasdaq + Yahoo" });

    // A fresh instance (as after a restart) answers from the database, asking no one.
    const again = await new CachedFundamentals(db, nasdaq, yahoo).getFundamentals("NVDA");
    expect(again).toMatchObject({ trailingPE: 28.6 });
    expect(nasdaq.calls).toBe(1);
    expect(yahoo.calls).toBe(1);
  });

  it("uses Yahoo alone for an Indian listing, and the last copy when nothing answers", async () => {
    const { db } = await createDb(":memory:");
    const nasdaq = fake({ trailingPE: 1 });
    const yahoo = fake({ trailingPE: 31.2, source: "Yahoo" });
    expect(await new CachedFundamentals(db, nasdaq, yahoo).getFundamentals("INFY.NS")).toMatchObject({ trailingPE: 31.2, source: "Yahoo" });
    expect(nasdaq.calls).toBe(0);
    expect(await new CachedFundamentals(db, fake(null), fake(null)).getFundamentals("ZZZ")).toBeNull();
  });
});
