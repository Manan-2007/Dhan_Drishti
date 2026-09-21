import { describe, it, expect } from "vitest";
import { DerivativeEstimateProvider } from "../src/market/providers/derivative-estimate.js";
import type { SecurityLike, BenchmarkProvider, BenchmarkBar } from "../src/market/types.js";

const fakeSpot = { getSpot: async (symbol: string) => (symbol === "^NSEI" ? 25000 : symbol === "ICICIBANK.NS" ? 1300 : null) };

const flatHistory: BenchmarkProvider = {
  id: "fake",
  async getHistory(): Promise<BenchmarkBar[]> {
    // A gently oscillating series so annualizedVolatility() has real (non-null) data to chew on.
    return Array.from({ length: 40 }, (_, i) => ({ date: `2025-01-${(i % 28) + 1}`, close: 25000 + (i % 2 === 0 ? 50 : -50) }));
  },
};

function sec(symbol: string): SecurityLike {
  return { id: symbol, symbol, assetClass: "other", currency: "INR" };
}

describe("DerivativeEstimateProvider", () => {
  it("prices a live (unexpired) NIFTY option from the underlying via Black-Scholes", async () => {
    const farExpiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // ~2 months out
    const yy = String(farExpiry.getUTCFullYear() % 100).padStart(2, "0");
    const mmm = farExpiry.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
    const symbol = `NIFTY${yy}${mmm}25000CE`;

    const provider = new DerivativeEstimateProvider(fakeSpot, flatHistory);
    const quotes = await provider.getQuotes([sec(symbol)]);

    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.provider).toBe("derivative-estimate");
    expect(quotes[0]!.currency).toBe("INR");
    expect(Number(quotes[0]!.price)).toBeGreaterThan(0);
  });

  it("skips an already-expired contract — no live estimate for a dead contract", async () => {
    const provider = new DerivativeEstimateProvider(fakeSpot, flatHistory);
    const quotes = await provider.getQuotes([sec("NIFTY24JAN20000CE")]); // Jan 2024, long expired
    expect(quotes).toHaveLength(0);
  });

  it("skips a contract on an underlying it can't resolve (e.g. an MCX commodity future)", async () => {
    const farExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const dd = String(farExpiry.getUTCDate()).padStart(2, "0");
    const mmm = farExpiry.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
    const yyyy = farExpiry.getUTCFullYear();
    const provider = new DerivativeEstimateProvider(fakeSpot, flatHistory);
    const quotes = await provider.getQuotes([sec(`FUT SILVERMIC ${dd} ${mmm} ${yyyy}`)]);
    expect(quotes).toHaveLength(0);
  });

  it("skips a security whose symbol isn't a recognizable derivative", async () => {
    const provider = new DerivativeEstimateProvider(fakeSpot, flatHistory);
    const quotes = await provider.getQuotes([sec("RANDOMJUNK")]);
    expect(quotes).toHaveLength(0);
  });

  it("prices a live single-stock future via cost-of-carry, close to spot", async () => {
    const farExpiry = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
    const dd = String(farExpiry.getUTCDate()).padStart(2, "0");
    const mmm = farExpiry.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
    const yyyy = farExpiry.getUTCFullYear();
    const provider = new DerivativeEstimateProvider(fakeSpot, flatHistory);
    const quotes = await provider.getQuotes([sec(`FUT ICICIBANK ${dd} ${mmm} ${yyyy}`)]);
    expect(quotes).toHaveLength(1);
    const price = Number(quotes[0]!.price);
    expect(price).toBeGreaterThan(1300); // cost-of-carry pushes the future above spot for r>0
    expect(price).toBeLessThan(1300 * 1.05); // but not wildly so, over ~45 days
  });
});
