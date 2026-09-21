import { describe, it, expect } from "vitest";
import { bsCall, bsPut, futuresFairValue, annualizedVolatility, normCdf } from "../src/market/pricing/black-scholes.js";

describe("normCdf", () => {
  it("matches known values", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe("Black-Scholes option pricing", () => {
  const base = { spot: 100, strike: 100, yearsToExpiry: 1, riskFreeRate: 0.05, volatility: 0.2 };

  it("prices an ATM call against a known reference value (~10.45)", () => {
    expect(bsCall(base)).toBeCloseTo(10.45, 1);
  });

  it("prices an ATM put against a known reference value (~5.57)", () => {
    expect(bsPut(base)).toBeCloseTo(5.57, 1);
  });

  it("satisfies put-call parity: C - P = S*e^-qT - K*e^-rT", () => {
    const c = bsCall(base);
    const p = bsPut(base);
    const rhs = base.spot - base.strike * Math.exp(-base.riskFreeRate * base.yearsToExpiry);
    expect(c - p).toBeCloseTo(rhs, 6);
  });

  it("collapses to intrinsic value at expiry (T=0)", () => {
    expect(bsCall({ ...base, spot: 120, yearsToExpiry: 0 })).toBe(20);
    expect(bsPut({ ...base, spot: 80, yearsToExpiry: 0 })).toBe(20);
  });

  it("a deep ITM call is worth more than a deep OTM call at the same spot", () => {
    const itm = bsCall({ ...base, strike: 50 });
    const otm = bsCall({ ...base, strike: 200 });
    expect(itm).toBeGreaterThan(otm);
  });
});

describe("futuresFairValue", () => {
  it("applies cost-of-carry above spot for a positive rate", () => {
    const fv = futuresFairValue(100, 0.07, 0.5);
    expect(fv).toBeGreaterThan(100);
    expect(fv).toBeCloseTo(100 * Math.exp(0.07 * 0.5), 6);
  });

  it("returns spot when already at/past expiry", () => {
    expect(futuresFairValue(100, 0.07, 0)).toBe(100);
  });
});

describe("annualizedVolatility", () => {
  it("returns null with too few observations", () => {
    expect(annualizedVolatility([100, 101, 99])).toBeNull();
  });

  it("returns 0 for a perfectly flat price series", () => {
    const flat = Array(20).fill(100);
    expect(annualizedVolatility(flat)).toBe(0);
  });

  it("returns a positive number for a noisy series", () => {
    const noisy = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? 2 : -2));
    const vol = annualizedVolatility(noisy);
    expect(vol).not.toBeNull();
    expect(vol!).toBeGreaterThan(0);
  });
});
