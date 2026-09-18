import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import * as XLSX from "xlsx";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
async function signup(u: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: u, password: "supersecret1" } });
  const raw = res.headers["set-cookie"];
  return (Array.isArray(raw) ? raw[0]! : (raw as string)).split(";")[0]!;
}
const post = (url: string, cookie: string, payload?: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
const mkPortfolio = async (cookie: string) => (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
const find = (rows: { security: { symbol: string } }[], s: string) => rows.find((h) => h.security.symbol === s);

/** Build a base64 .xlsx from named sheets, each given as an array-of-arrays. */
function xlsxBase64(sheets: Record<string, (string | number)[][]>): string {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
}

beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db);
  await app.ready();
});

describe("Excel (.xlsx) import", () => {
  // Mirrors the real Zerodha "Combined" holdings sheet: a preamble, then a table splitting quantity
  // across Available / Long Term / Pledged buckets.
  const zerodhaHoldings = () =>
    xlsxBase64({
      "My Account": [["Client ID", "BH0001"]],
      Combined: [
        ["Client ID", "BH0001"],
        ["Combined Holdings Statement as on 2026-09-18"],
        ["Summary"],
        ["Invested Value", 100000],
        [],
        ["Symbol", "ISIN", "Sector", "Instrument Type", "Quantity Available", "Quantity Discrepant", "Quantity Long Term", "Quantity Pledged (Margin)", "Quantity Pledged (Loan)", "Average Price", "Previous Closing Price", "Unrealized P&L", "Unrealize P&L Pct."],
        ["BAJFINANCE", "INE296A01032", "FINANCIAL SERVICES", "-", 30, 0, 100, 100, 0, 950, 1016, 8580, 6.9],
        ["LIQUIDCASE", "INF247Y01958", "-", "Debt - Liquid", 0, 0, 0, 500, 0, 1000, 1001, 500, 0.1],
      ],
    });

  it("imports a Zerodha holdings workbook: right sheet, pledged-aware quantity, MF sector, seeded value", async () => {
    const cookie = await signup("xl1");
    const pid = await mkPortfolio(cookie);
    const payload = { portfolioId: pid, broker: "zerodha-holdings", filename: "holdings.xlsx", encoding: "base64", content: zerodhaHoldings() };

    const preview = (await post("/api/imports/check", cookie, payload)).json();
    expect(preview.toImport).toBe(2); // the two real positions, not the preamble/summary rows

    await post("/api/imports/commit", cookie, payload);
    const h = (await get("/api/holdings", cookie)).json();

    // qty = Available + max(Long Term, Pledged Margin + Pledged Loan) = 30 + max(100, 100) = 130.
    const baj = find(h.holdings, "BAJFINANCE")!;
    expect(baj.netQty).toBe("130");
    expect(Number(baj.currentValue)).toBeCloseTo(130 * 1016, 2); // previous close seeded as the quote

    // The liquid fund is classified Debt straight from its instrument type.
    const liq = find(h.holdings, "LIQUIDCASE")!;
    expect(liq.netQty).toBe("500");
    expect(liq.security.assetClass).toBe("mf");
    expect(liq.security.sector).toBe("Debt");
  });

  it("picks the Trades sheet from a Vested transactions workbook and imports USD trades", async () => {
    const cookie = await signup("xl2");
    const pid = await mkPortfolio(cookie);
    const content = xlsxBase64({
      "My Account": [["Name", "Tester"]],
      // A cash ledger the trades adapter can't read — must NOT be chosen despite having more rows.
      "All Transactions": [["Date", "Time (in UTC)", "Type", "Amount", "Account Balance", "Comment"], ...Array.from({ length: 20 }, (_, i) => ["2026-09-14", "10:00:00 AM", "DIV", 0.1, 100 + i, "x"])],
      Trades: [
        ["Date", "Time (in UTC)", "Name", "Ticker", "Activity", "Order Type", "Quantity", "Price Per Share (in USD)", "Cash Amount (in USD)", "Commission Charges (in USD)"],
        ["2026-09-14", "02:00:19 PM", "Apple Inc.", "AAPL", "Buy", "Market", 2, 200, 400, 0],
        ["2026-09-15", "02:00:19 PM", "Apple Inc.", "AAPL", "Sell", "Market", 1, 210, 210, 0],
      ],
    });
    const payload = { portfolioId: pid, broker: "vested", filename: "vested.xlsx", encoding: "base64", content };

    const preview = (await post("/api/imports/check", cookie, payload)).json();
    expect(preview.detected.broker).toBe("vested");
    expect(preview.toImport).toBe(2); // one buy + one sell from the Trades sheet only

    await post("/api/imports/commit", cookie, payload);
    const h = (await get("/api/holdings", cookie)).json();
    const aapl = find(h.holdings, "AAPL")!;
    expect(aapl.netQty).toBe("1"); // 2 bought − 1 sold
    expect(aapl.security.currency).toBe("USD");
  });
});

describe("price-seed from a holdings snapshot (no cost basis)", () => {
  // A Dhan-style holding CSV: a closing price per scrip, ISIN, but no average cost.
  const dhanHolding = [
    "Scrip Name,ISIN Code,Closing Price",
    '"Reliance Industries","INE002A01018","1240"',
    '"Infosys Ltd","INE009A01021","1060"',
    '"Unknown Corp","INE999999999","500"',
  ].join("\n");

  it("seeds current prices for held securities by ISIN and by name, reporting unmatched", async () => {
    const cookie = await signup("ps1");
    const pid = await mkPortfolio(cookie);

    // Seed two positions with cost but no live price (no LTP column → currentValue starts null).
    const holdings = [
      "Instrument,ISIN,Qty.,Avg. cost",
      '"Reliance Industries",INE002A01018,10,1200', // will match by ISIN
      '"Infosys",,20,1500', // no ISIN → must match by normalized name ("Infosys Ltd" ≈ "Infosys")
    ].join("\n");
    await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "holdings", filename: "h.csv", content: holdings });

    let h = (await get("/api/holdings", cookie)).json();
    expect(find(h.holdings, "RELIANCE INDUSTRIES")!.currentValue).toBeNull();

    const seed = (await post("/api/imports/seed-prices", cookie, { portfolioId: pid, filename: "Holding.csv", content: dhanHolding })).json();
    expect(seed.seeded).toBe(2);
    expect(seed.unmatchedCount).toBe(1);
    expect(seed.unmatched).toContain("Unknown Corp");

    h = (await get("/api/holdings", cookie)).json();
    expect(Number(find(h.holdings, "RELIANCE INDUSTRIES")!.currentValue)).toBeCloseTo(10 * 1240, 2);
    expect(Number(find(h.holdings, "INFOSYS")!.currentValue)).toBeCloseTo(20 * 1060, 2);
  });
});
