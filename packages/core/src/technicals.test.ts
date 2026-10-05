import { describe, it, expect } from "vitest";
import { sma, ema, rsi, computeTechnicals, type PriceBar } from "./technicals.js";

const bars = (closes: number[], start = "2025-01-01"): PriceBar[] => {
  const d0 = Date.parse(`${start}T00:00:00Z`);
  return closes.map((close, i) => ({ date: new Date(d0 + i * 86_400_000).toISOString().slice(0, 10), close }));
};

describe("sma", () => {
  it("is null until the window fills, then the rolling mean", () => {
    const out = sma([2, 4, 6, 8, 10], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBe("4"); // (2+4+6)/3
    expect(out[3]).toBe("6"); // (4+6+8)/3
    expect(out[4]).toBe("8"); // (6+8+10)/3
  });
});

describe("ema", () => {
  it("seeds with the first-window SMA and decays by 2/(n+1)", () => {
    // period 3 → k = 0.5; seed = mean(1,2,3) = 2; next = 4 → 2 + 0.5*(4-2) = 3; next = 5 → 3 + 0.5*(5-3) = 4
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[2]).toBe("2");
    expect(out[3]).toBe("3");
    expect(out[4]).toBe("4");
  });
  it("is all null when there are fewer bars than the period", () => {
    expect(ema([1, 2], 5).every((x) => x === null)).toBe(true);
  });
});

describe("rsi", () => {
  it("is ~100 for a straight climb and low for a straight fall", () => {
    const up = rsi(Array.from({ length: 20 }, (_, i) => 100 + i), 14);
    expect(up[19]).toBe(100); // no losses → RSI 100
    const down = rsi(Array.from({ length: 20 }, (_, i) => 100 - i), 14);
    expect(down[19]!).toBeLessThan(5); // no gains → RSI ~0
  });
  it("is null until there are more than `period` bars", () => {
    expect(rsi([1, 2, 3], 14).every((x) => x === null)).toBe(true);
  });
});

describe("computeTechnicals", () => {
  it("summarises ranges, position and trend from a real series", () => {
    // 260 rising days 100..359, so the latest is the 52-week high and well above every SMA.
    const t = computeTechnicals(bars(Array.from({ length: 260 }, (_, i) => 100 + i)));
    expect(t.bars).toBe(260);
    expect(t.last).toBe("359");
    expect(t.trend).toBe("above");
    expect(t.rangePosition52w).toBeCloseTo(1, 2); // at the top of the band
    expect(Number(t.ranges.year!.high)).toBe(359);
    expect(t.changePct.week).toBeGreaterThan(0);
    expect(t.sma[200]).not.toBeNull();
    expect(t.rsi14).toBeGreaterThan(99);
    expect(Number(t.resistance)).toBeGreaterThan(Number(t.support));
  });

  it("degrades gracefully with a short series (longer MAs stay null)", () => {
    const t = computeTechnicals(bars([10, 11, 12, 13, 14]));
    expect(t.last).toBe("14");
    expect(t.sma[200]).toBeNull();
    expect(t.sma[50]).toBeNull();
    expect(t.ranges.year).not.toBeNull(); // uses whatever is available
    expect(t.ranges.year!.low).toBe("10");
  });

  it("returns all-null on an empty series without throwing", () => {
    const t = computeTechnicals([]);
    expect(t).toMatchObject({ last: null, asOf: null, rsi14: null, trend: null, bars: 0 });
    expect(t.ranges.year).toBeNull();
  });
});
