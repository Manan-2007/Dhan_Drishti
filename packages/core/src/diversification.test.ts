import { describe, it, expect } from "vitest";
import { computeDiversification, type DivPosition } from "./diversification.js";

const pos = (label: string, sector: string, value: string): DivPosition => ({ label, sector, value });

describe("computeDiversification", () => {
  it("reports unavailable for an empty or valueless portfolio", () => {
    expect(computeDiversification([]).available).toBe(false);
    expect(computeDiversification([pos("A", "Tech", "0")]).available).toBe(false);
  });

  it("flags a single dominant holding as concentrated with a low score", () => {
    const r = computeDiversification([pos("HDFC", "BFSI", "90"), pos("TCS", "IT", "10")]);
    expect(r.available).toBe(true);
    expect(r.top1?.label).toBe("HDFC");
    expect(r.top1?.weight).toBeCloseTo(0.9, 5);
    expect(r.hhi).toBeCloseTo(0.9 * 0.9 + 0.1 * 0.1, 5);
    expect(r.grade).toBe("Concentrated");
    expect(r.flags.some((f) => f.severity === "high")).toBe(true);
  });

  it("scores a broad, multi-sector portfolio well", () => {
    const rows = [
      pos("A", "IT", "100"),
      pos("B", "BFSI", "100"),
      pos("C", "Auto", "100"),
      pos("D", "Pharma", "100"),
      pos("E", "FMCG", "100"),
      pos("F", "Energy", "100"),
      pos("G", "Metals", "100"),
      pos("H", "Realty", "100"),
      pos("I", "Telecom", "100"),
      pos("J", "Infra", "100"),
    ];
    const r = computeDiversification(rows);
    expect(r.positions).toBe(10);
    expect(r.effectiveHoldings).toBeCloseTo(10, 5);
    expect(r.sectors).toBe(10);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.grade).toBe("Excellent");
    expect(r.top5Weight).toBeCloseTo(0.5, 5);
  });

  it("flags sector concentration even when holdings are numerous", () => {
    const rows = [
      pos("A", "IT", "30"),
      pos("B", "IT", "30"),
      pos("C", "IT", "20"),
      pos("D", "Pharma", "10"),
      pos("E", "FMCG", "10"),
    ];
    const r = computeDiversification(rows);
    expect(r.topSector?.label).toBe("IT");
    expect(r.topSector?.weight).toBeCloseTo(0.8, 5);
    expect(r.flags.some((f) => f.severity === "high" && f.message.includes("IT"))).toBe(true);
  });

  it("ignores non-positive values in the total", () => {
    const r = computeDiversification([pos("A", "IT", "50"), pos("B", "BFSI", "50"), pos("C", "Auto", "-5")]);
    expect(r.positions).toBe(2);
    expect(r.top1?.weight).toBeCloseTo(0.5, 5);
  });
});
