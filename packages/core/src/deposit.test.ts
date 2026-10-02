import { describe, it, expect } from "vitest";
import { depositValue } from "./deposit.js";

const fd = { principal: "100000", ratePct: "7", start: "2025-01-01", maturity: "2026-01-01", compounding: "quarterly" as const };

describe("depositValue", () => {
  it("compounds quarterly to the bank's maturity amount", () => {
    const v = depositValue(fd, "2026-06-01");
    // 1,00,000 × (1 + 0.07/4)^4 = 1,07,185.90
    expect(v.maturityValue!.toFixed(2)).toBe("107185.90");
    expect(v.value.toFixed(2)).toBe("107185.90"); // stops growing after maturity
    expect(v.matured).toBe(true);
  });

  it("is part-way there mid-term, with days left and share elapsed", () => {
    const v = depositValue(fd, "2025-07-02");
    expect(Number(v.value.toFixed(2))).toBeGreaterThan(103400);
    expect(Number(v.value.toFixed(2))).toBeLessThan(103600);
    expect(v.daysToMaturity).toBe(183);
    expect(v.elapsed).toBeCloseTo(182 / 365, 3);
    expect(v.matured).toBe(false);
  });

  it("keeps a payout deposit at its principal and counts interest paid out", () => {
    const v = depositValue({ ...fd, compounding: "payout" }, "2025-07-02");
    expect(v.value.toFixed()).toBe("100000");
    expect(v.interestSoFar.toFixed(0)).toBe("3490"); // 7% × 182/365
  });

  it("accrues simple interest, and is just the principal before it starts", () => {
    expect(depositValue({ ...fd, compounding: "simple" }, "2026-01-01").value.toFixed(0)).toBe("107000");
    expect(depositValue(fd, "2024-12-01").value.toFixed()).toBe("100000");
  });
});
