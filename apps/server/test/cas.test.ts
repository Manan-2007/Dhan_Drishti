import { describe, it, expect } from "vitest";
import { parseCasTransactions } from "../src/import/cas.js";

// Representative reconstructed text from a detailed CAMS/KFintech CAS (two AMCs, mixed activity).
const CAS_TEXT = [
  "Consolidated Account Statement",
  "Folio No: 12345678 / 21    PAN: ABCDE1234F   KYC: OK",
  "Parag Parikh Flexi Cap Fund - Direct Plan - Growth ISIN: INF879O01027 (Advisor: DIRECT) Registrar : CAMS",
  "Opening Unit Balance: 0.000",
  "05-Apr-2025 Purchase 50,000.00 780.123 64.092 780.123",
  "10-May-2025 SIP Purchase 10,000.00 152.045 65.771 932.168",
  "15-Jun-2025 Redemption (20,000.00) (300.000) 66.100 632.168",
  "20-Jul-2025 *** Stamp Duty *** 2.50 0.000 0.000 632.168",
  "Closing Unit Balance: 632.168",
  "HDFC Liquid Fund - Direct Plan - Growth ISIN: INF179K01XA9 Registrar : KFINTECH",
  "Folio No: 99887766",
  "02-Apr-2025 Purchase 100,000.00 22.500 4444.44 22.500",
  "08-Aug-2025 Dividend Payout 500.00 0.000 0.000 22.500",
].join("\n");

describe("CAS (Consolidated Account Statement) parser", () => {
  const rows = parseCasTransactions(CAS_TEXT).filter((r) => r.ok);
  const tx = (i: number) => (rows[i]!.ok ? rows[i]!.tx : null)!;

  it("reads every fund's transactions and skips stamp duty", () => {
    expect(rows.length).toBe(5); // 3 buys + 1 sell + 1 dividend; the stamp-duty row is skipped
  });

  it("maps purchases/SIPs to buys with units as quantity and NAV as price", () => {
    const buy = tx(0);
    expect(buy.type).toBe("buy");
    expect(buy.security?.isin).toBe("INF879O01027");
    expect(buy.security?.name).toContain("Parag Parikh Flexi Cap Fund");
    expect(buy.security?.assetClass).toBe("mf");
    expect(buy.quantity).toBe("780.123");
    expect(buy.price).toBe("64.092");
    expect(buy.grossAmount).toBe("50000");
    expect(buy.tradeDate.slice(0, 10)).toBe("2025-04-05");
  });

  it("maps redemptions to sells (parentheses = negative units)", () => {
    const sell = rows.map((r) => r.ok && r.tx).find((t) => t && t.type === "sell");
    expect(sell).toBeTruthy();
    expect(sell!.quantity).toBe("300");
    expect(sell!.grossAmount).toBe("20000");
  });

  it("attributes rows to the right fund after the scheme switches, and reads a dividend payout", () => {
    const div = rows.map((r) => r.ok && r.tx).find((t) => t && t.type === "dividend");
    expect(div!.security?.isin).toBe("INF179K01XA9");
    expect(div!.grossAmount).toBe("500");
    expect(div!.quantity).toBe("0");
  });

  it("returns nothing for a statement with no transaction rows", () => {
    expect(parseCasTransactions("Consolidated Account Statement\nSummary only\nNo transactions").length).toBe(0);
  });
});
