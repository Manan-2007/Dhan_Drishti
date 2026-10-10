import { describe, it, expect, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import { sniffFile } from "../src/import/detect.js";
import { parsePnlFile } from "../src/import/pnl-report.js";

/** Build a workbook from sheets of rows and return it the way an upload arrives. */
function workbook(filename: string, sheets: Record<string, (string | number)[][]>) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { filename, content: buf.toString("base64"), encoding: "base64" as const };
}

const EXIT_HEAD = ["Symbol", "ISIN", "Entry Date", "Exit Date", "Quantity", "Buy Value", "Sell Value", "Profit", "Period of Holding"];
const TAXPNL = () =>
  workbook("taxpnl-AB1234-2025_2026-Q1-Q4.xlsx", {
    "Tradewise Exits from 2025-04-01": [
      ["View Zerodha's guide on using tax reports for filing."],
      ["Client ID", "AB1234"],
      ["Client Name", "Test Person"],
      ["Tradewise Exits from 2025-04-01 to 2026-03-31"],
      ["Equity - Intraday"],
      EXIT_HEAD,
      ["INFY", "INE009A01021", "2025-05-19", "2025-05-19", 10, 15000, 15100, 100, 0],
      ["Equity - Short Term"],
      EXIT_HEAD,
      ["INFY", "INE009A01021", "2025-06-01", "2025-09-01", 5, 7000, 7600, 600, 92],
      ["TCS", "INE467B01029", "2025-06-01", "2025-08-01", 2, 6000, 5800, -200, 61],
      ["Equity - Long Term"],
      EXIT_HEAD,
    ],
    "Dividends & Interest": [
      ["Client ID", "AB1234"],
      ["Equity Dividends & Debt interest from 2025-04-01 to 2026-03-31"],
      ["Quarterly Breakdown", "Net Dividend Amount"],
      ["Upto 15-Jun-2025", 120],
      [""],
      ["Symbol", "ISIN", "Ex-date", "Quantity", "Dividend Per Share", "Net Dividend Amount"],
      ["ITC", "INE154A01025", "2025-06-04", 50, 2.4, 120],
      ["Dividends are credited to your registered bank account within 30–45 days from the ex-date."],
    ],
  });

describe("broker profit reports", () => {
  it("reads Zerodha's tax P&L: sections, totals, period, broker and its dividends", () => {
    const file = TAXPNL();
    const sniff = sniffFile(file);
    expect(sniff).toMatchObject({ kind: "pnl_report", brokerFamily: "zerodha", accountRef: "AB1234", holderName: "Test Person" });

    const r = parsePnlFile(file);
    expect(r).toMatchObject({ from: "2025-04-01", to: "2026-03-31", currency: "INR" });
    expect(r.netPnl?.toFixed()).toBe("500"); // 100 + 600 − 200
    const infy = r.rows.find((x) => x.name === "INFY")!;
    expect(infy.quantity.toFixed()).toBe("15"); // intraday + short-term lots of the same share, summed
    expect(infy.sellValue.toFixed()).toBe("22700");
    expect(r.dividends).toHaveLength(1);
    expect(r.dividends![0]).toMatchObject({ ok: true, tx: { type: "dividend", grossAmount: "120", security: { symbol: "ITC", isin: "INE154A01025" } } });
  });

  it("reads Zerodha's P&L statement, whose total is labelled Realized P&L", () => {
    const file = workbook("pnl-AB1234.xlsx", {
      Equity: [
        ["Client ID", "AB1234"],
        ["P&L Statement for Equity from 2025-05-15 to 2026-05-15"],
        ["Summary"],
        ["Realized P&L", 797.78],
        [""],
        ["Symbol", "ISIN", "Quantity", "Buy Value", "Sell Value", "Realized P&L"],
        ["HELD", "INE000000001", 0, 0, 0, 0],
        ["LIQUIDCASE", "INF0R8F01034", 425, 46474.8, 47273.7, 798.9],
        ["BFSI", "INF769K01HI8", 16, 437.76, 437.28, -0.48],
        ["BANKIETF", "INF109KC15I8", 8, 452.8, 452.16, -0.64],
      ],
    });
    expect(sniffFile(file)).toMatchObject({ kind: "pnl_report", brokerFamily: "zerodha", accountRef: "AB1234" });
    const r = parsePnlFile(file);
    expect(r).toMatchObject({ from: "2025-05-15", to: "2026-05-15" });
    expect(r.netPnl?.toFixed()).toBe("797.78");
    expect(r.rows.map((x) => x.name)).toEqual(["LIQUIDCASE", "BFSI", "BANKIETF"]); // held-only rows skipped
  });

  it("reads Vested's Profit-Loss Statement in USD, with the account number from a column layout", () => {
    const file = workbook("Profit-Loss Statement - 2025-05-15 - 2026-10-09.xlsx", {
      "User Details": [
        ["Period", "Name", "PAN", "DriveWealth Acc No"],
        ["2025-05-15 to 2026-10-09", "Test Person", "XXXXX0000X", "VSGG000001"],
      ],
      "Realized P&L - Summary ": [
        ["Security", "Quantity", "Proceeds (USD)", "Cost Basis (USD)", "Profit/Loss (USD)", "Profit/Loss (%)"],
        ["AAPL", 0.5, 120, 100, 20, 20],
        ["TSLA", 0.25, 40, 50, -10, -20],
      ],
    });
    expect(sniffFile(file)).toMatchObject({ kind: "pnl_report", brokerFamily: "vested", accountRef: "VSGG000001", holderName: "Test Person" });
    const r = parsePnlFile(file);
    expect(r).toMatchObject({ from: "2025-05-15", to: "2026-10-09", currency: "USD" });
    expect(r.netPnl?.toFixed()).toBe("10");
    expect(r.rows.find((x) => x.name === "AAPL")!.buyValue.toFixed()).toBe("100");
  });
});

describe("importing a Zerodha tax P&L", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    const { db } = await createDb(":memory:");
    app = buildApp(db, { fxProvider: { id: "fake", async getRate() { return null; }, async getRateOn() { return null; } } });
    await app.ready();
  });

  it("adds its dividends to the ledger once, however many times it's dropped", async () => {
    const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "taxpnl1", password: "supersecret1" } });
    const cookie = String(reg.headers["set-cookie"]).split(";")[0]!;
    const target = { newAccount: { newPortfolioName: "Me", broker: "zerodha", accountRef: "AB1234", name: "Zerodha · AB1234" } };
    const drop = (t: object) => app.inject({ method: "POST", url: "/api/imports/commit-many", headers: { cookie }, payload: { items: [{ ...TAXPNL(), kind: "pnl_report", target: t }] } });

    const first = await drop(target);
    expect(first.statusCode).toBe(201);
    expect(first.json().files[0].imported).toBe(1);
    const accountId = first.json().files[0].accountId;

    const again = await drop({ accountId });
    expect(again.json().files[0].imported).toBe(0);
    expect(again.json().files[0].duplicates).toBe(1);

    const txs = (await app.inject({ method: "GET", url: "/api/transactions?type=dividend", headers: { cookie } })).json().transactions;
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ type: "dividend", grossAmount: "120" });
  });
});
