import { describe, it, expect } from "vitest";
import { portfolioXray, type XrayInput } from "./xray.js";

const base: XrayInput = {
  netWorth: 100000,
  cash: 0,
  manualAssets: 0,
  byAssetClass: [{ key: "equity", weight: 1 }],
  diversification: { available: true, positions: 10, score: 85, top1: { label: "ABC", weight: 0.1 }, top5Weight: 0.45, topSector: { label: "IT", weight: 0.3 } },
};

describe("portfolioXray", () => {
  it("is unavailable with no net worth", () => {
    expect(portfolioXray({ ...base, netWorth: 0 }).available).toBe(false);
  });

  it("flags a heavy single-stock bet as high severity", () => {
    const r = portfolioXray({ ...base, diversification: { ...base.diversification, top1: { label: "RELIANCE", weight: 0.5 }, score: 40 } });
    const f = r.findings.find((x) => x.id === "concentration");
    expect(f?.severity).toBe("high");
    expect(f?.detail).toContain("RELIANCE");
    expect(r.findings[0]!.severity).toBe("high"); // sorted most-severe first
  });

  it("flags cash drag and docks the score", () => {
    const r = portfolioXray({ ...base, cash: 40000 }); // 40% cash
    const f = r.findings.find((x) => x.id === "cash-drag");
    expect(f?.severity).toBe("high");
    expect(r.cashWeight).toBeCloseTo(0.4, 6);
    expect(r.score).toBe(85 - 25); // capped 25-point penalty
  });

  it("notes being almost entirely one asset class (info, not a warning)", () => {
    const r = portfolioXray({ ...base, byAssetClass: [{ key: "equity", weight: 0.98 }, { key: "cash", weight: 0.02 }] });
    const f = r.findings.find((x) => x.id === "class-skew");
    expect(f?.severity).toBe("info");
    expect(f?.detail).toContain("equities");
  });

  it("says well balanced when nothing is wrong", () => {
    const r = portfolioXray(base);
    expect(r.grade).toBe("Healthy");
    expect(r.findings.some((f) => f.severity === "high" || f.severity === "warn")).toBe(false);
    expect(r.findings.at(-1)!.id).toBe("ok");
  });
});
