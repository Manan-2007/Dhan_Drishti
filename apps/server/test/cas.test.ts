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

// A representative CAMS "detailed" statement with the real-world variety of row types.
const CAMS_DETAILED = [
  "Consolidated Account Statement",
  "01-Apr-2024 To 31-Mar-2025",
  "HDFC Balanced Advantage Fund - Direct Plan - Growth Option ISIN: INF179K01WN9 (Advisor: DIRECT) Registrar : CAMS",
  "Folio No: 1234567890 / 0    PAN: ABCDE1234F   KYC: OK",
  "Opening Unit Balance: 0.000",
  "01-Apr-2024 ***Stamp Duty*** 0.25 0.000 0.000 0.000",
  "01-Apr-2024 Purchase-SIP 5,000.00 15.234 328.1234 15.234",
  "12-Aug-2024 IDCW Payout @ Rs. 1.5000 per unit 22.85 15.234",
  "12-Aug-2024 IDCW Reinvestment @ Rs. 1.5000 per unit 22.85 0.069 331.8841 15.303",
  "15-Sep-2024 Systematic Transfer In 2,000.00 6.010 332.7787 21.313",
  "20-Oct-2024 SWP - Systematic Withdrawal (1,000.00) (2.990) 334.4481 18.323",
  "NAV on 31-Mar-2025 : INR 340.5000",
  "Closing Unit Balance: 18.323",
].join("\n");

// A KFintech statement: ISIN in parentheses, a wrapped scheme name, a merger switch, a TDS row.
const KFINTECH = [
  "Aditya Birla Sun Life Frontline Equity Fund",
  "- Direct Plan - Growth (ISIN: INF209K01UN8) Registrar : KFINTECH",
  "Folio No : 9988776655",
  "05-Nov-2024 Switch In - from ABC Liquid (Merger) 10,000.00 30.100 332.2259 30.100",
  "10-Dec-2024 Switch Out - to XYZ Fund (5,000.00) (15.050) 332.2259 15.050",
  "20-Dec-2024 TDS Deducted 75.00 0.000 0.000 15.050",
];

describe("CAS parser — real-world statement variety", () => {
  it("reads a CAMS detailed statement, skipping stamp duty and reading payout vs reinvest correctly", () => {
    const rows = parseCasTransactions(CAMS_DETAILED).filter((r) => r.ok);
    const txs = rows.map((r) => (r.ok ? r.tx : null)!);
    // stamp-duty skipped; the rest: SIP buy, IDCW payout, IDCW reinvest (buy), STP-in buy, SWP sell.
    expect(txs).toHaveLength(5);
    expect(txs.map((t) => t.type)).toEqual(["buy", "dividend", "buy", "buy", "sell"]);

    const sip = txs[0]!;
    expect(sip.type).toBe("buy");
    expect(sip.quantity).toBe("15.234");
    expect(sip.price).toBe("328.1234");
    expect(sip.grossAmount).toBe("5000");
    expect(sip.security?.isin).toBe("INF179K01WN9");
    expect(sip.security?.name).toContain("HDFC Balanced Advantage Fund");

    // Dividend PAYOUT row has only [amount, balance] — no units/nav columns.
    const payout = txs[1]!;
    expect(payout.type).toBe("dividend");
    expect(payout.grossAmount).toBe("22.85");
    expect(payout.quantity).toBe("0");

    // Dividend REINVEST carries units, so it's a buy (cost basis grows), not a cash dividend.
    expect(txs[2]!.type).toBe("buy");
    expect(txs[2]!.quantity).toBe("0.069");

    const swp = txs[4]!;
    expect(swp.type).toBe("sell");
    expect(swp.quantity).toBe("2.99");
    expect(swp.grossAmount).toBe("1000");
  });

  it("reads a KFintech statement: ISIN in parens, wrapped name, merger switch, TDS skipped", () => {
    const rows = parseCasTransactions(KFINTECH.join("\n")).filter((r) => r.ok);
    const txs = rows.map((r) => (r.ok ? r.tx : null)!);
    expect(txs).toHaveLength(2); // switch-in (buy) + switch-out (sell); TDS skipped
    expect(txs[0]!.type).toBe("buy");
    expect(txs[0]!.security?.isin).toBe("INF209K01UN8");
    // The wrapped AMC name is stitched back onto the plan/option fragment beside the ISIN.
    expect(txs[0]!.security?.name).toContain("Aditya Birla Sun Life Frontline Equity Fund");
    expect(txs[0]!.security?.name).toContain("Growth");
    expect(txs[1]!.type).toBe("sell");
    expect(txs[1]!.quantity).toBe("15.05");
  });

  it("back-derives a zero/blank NAV column from amount ÷ units", () => {
    const text = [
      "Some Debt Fund - Growth ISIN: INF999X01AB2 Registrar : CAMS",
      "01-Jun-2024 Purchase 10,000.00 4.000 0.0000 4.000", // NAV column present but blank/zero
    ].join("\n");
    const tx = parseCasTransactions(text).filter((r) => r.ok).map((r) => (r.ok ? r.tx : null)!)[0]!;
    expect(tx.type).toBe("buy");
    expect(tx.grossAmount).toBe("10000");
    expect(tx.quantity).toBe("4");
    expect(tx.price).toBe("2500"); // back-derived: 10000 ÷ 4
  });

  it("skips statement-period and NAV note lines that begin with a date but have no columns", () => {
    const text = [
      "X Fund - Growth ISIN: INF111A01AA1 Registrar : CAMS",
      "01-Apr-2024 To 31-Mar-2025",
      "01-Apr-2024 Purchase 1,000.00 3.000 333.3333 3.000",
    ].join("\n");
    const rows = parseCasTransactions(text).filter((r) => r.ok);
    expect(rows).toHaveLength(1);
  });

  it("classifies a redemption shown with a negative amount and units as a sell", () => {
    const text = [
      "Y Fund - Growth ISIN: INF222B01BB2 Registrar : KFINTECH",
      "01-Apr-2024 Purchase 50,000.00 100.000 500.0000 100.000",
      "01-Sep-2024 Redemption (25,000.00) (50.000) 500.0000 50.000",
    ].join("\n");
    const txs = parseCasTransactions(text).filter((r) => r.ok).map((r) => (r.ok ? r.tx : null)!);
    expect(txs[1]!.type).toBe("sell");
    expect(txs[1]!.quantity).toBe("50");
    expect(txs[1]!.grossAmount).toBe("25000");
  });
});
