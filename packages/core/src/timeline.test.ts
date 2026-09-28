import { describe, it, expect } from "vitest";
import { valueTimeline } from "./timeline.js";
import type { CanonicalTx } from "./types.js";

let n = 0;
const tx = (p: Partial<CanonicalTx> & Pick<CanonicalTx, "type" | "tradeDate">): CanonicalTx => ({
  id: `t${++n}`, userId: "u", portfolioId: "p", accountId: null, securityId: "A", settleDate: null,
  quantity: "0", price: "0", grossAmount: "0", fees: "0", taxes: "0", currency: "INR", fxRateToBase: null,
  segment: "equity", externalRef: null, rawRowHash: `h${n}`, sourceBroker: null, notes: null, ...p,
});

const closes: Record<string, Record<string, number>> = {
  A: { "2025-01-01": 100, "2025-01-02": 110, "2025-01-03": 120 },
  B: { "2025-01-02": 50, "2025-01-03": 40 },
};
const lastClose = (sid: string, date: string) => {
  const days = Object.keys(closes[sid] ?? {}).filter((d) => d <= date).sort();
  return days.length ? closes[sid]![days[days.length - 1]!]! : null;
};

describe("valueTimeline", () => {
  it("values open positions at each day's close and tracks what went in", () => {
    const pts = valueTimeline(
      [
        tx({ type: "buy", tradeDate: "2025-01-01T00:00:00.000Z", quantity: "10", price: "100" }),
        tx({ type: "buy", tradeDate: "2025-01-02T00:00:00.000Z", securityId: "B", quantity: "4", price: "50" }),
        tx({ type: "sell", tradeDate: "2025-01-03T00:00:00.000Z", quantity: "5", price: "120" }),
      ],
      ["2025-01-01", "2025-01-02", "2025-01-03"],
      lastClose,
      () => 1,
    );
    expect(pts.map((p) => [p.date, p.value, p.invested])).toEqual([
      ["2025-01-01", 1000, 1000],
      ["2025-01-02", 1100 + 200, 1000 + 200],
      ["2025-01-03", 5 * 120 + 4 * 40, 500 + 200],
    ]);
  });

  it("counts a position at cost until it has a price, and converts foreign holdings", () => {
    const pts = valueTimeline(
      [tx({ type: "buy", tradeDate: "2025-01-01T00:00:00.000Z", securityId: "B", quantity: "2", price: "45", currency: "USD", fxRateToBase: "80" })],
      ["2025-01-01", "2025-01-02"],
      lastClose,
      (c) => (c === "USD" ? 85 : 1),
    );
    expect(pts[0]).toMatchObject({ value: 7200, invested: 7200, atCost: 7200 }); // no close yet
    expect(pts[1]).toMatchObject({ value: 2 * 50 * 85, invested: 7200, atCost: 0 });
  });

  it("doesn't count shares sold before the history as a negative holding", () => {
    const pts = valueTimeline([tx({ type: "sell", tradeDate: "2025-01-01T00:00:00.000Z", quantity: "10", price: "100" })], ["2025-01-02"], lastClose, () => 1);
    expect(pts[0]).toMatchObject({ value: 0, invested: 0 });
  });
});
