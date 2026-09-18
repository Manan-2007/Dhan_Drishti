import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
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

beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db);
  await app.ready();
});

// Real Dhan exports carry preamble rows before the table — the parser must skip them.
const DHAN_TXN = [
  "Global transction report,From 01-04-2025 to 31-03-2026",
  "Name,TESTER",
  "UCC,ABC123",
  "",
  "Date,Scrip Name,Exchange,Bill No.,Buy Qty.,Buy Value,Sell Qty.,Sell Value,Brokerage,GST,STT,SEBI Fees,Stamp Duty,Txn. Charges,Oth. Charges,Gross Amount",
  '"01 Apr 2025 00:00:00","Reliance Industries","NSE","2211","10","12000","0","0.00","0","0","0","0","0","1","0","-12001"',
  '"05 Apr 2025 00:00:00","Reliance Industries","NSE","2211","0","0","4","5200","0","0","0","0","0","1","0","5199"',
  '"10 Apr 2025 00:00:00","OPT NIFTY 24 Apr 2025 23800 PE","NSE","2211","150","56055","150","57397.50","40","14.48","57","0.11","2","39.74","0.57","1188.60"',
  '"Grand Total","Summary","","","","","","","","","","","","","","1200"', // footer/total row → flagged
].join("\n");

const DHAN_FUNDS = [
  "Fund Summary,From 01-04-2025 to 31-03-2026",
  "Name,TESTER",
  "",
  "Date & Time,Transaction Type,Bank,Mode,Amount,Status",
  '"01 Apr 2025 10:00:00","Funds Added","HDFC","upi","50000.00","SUCCESS"',
  '"01 May 2025 10:00:00","Funds Withdrawn","HDFC","neft","10000.00","SUCCESS"',
  '"02 May 2025 10:00:00","Funds Added","HDFC","upi","5000.00","FAILED"',
].join("\n");

const DHAN_DIV = [
  "Dividend payout report,From 01-04-2025 to 31-03-2026",
  "Name,TESTER",
  "",
  "Date,Scrip Name,Dividend Per Share,Quantity,Dividend Paid",
  '"23 Mar 2026","Power Finance Corporation","3.25","1600","5200.00"',
  '"12 Mar 2026","Indian Oil Corporation","2.00","460","920.00"',
].join("\n");

describe("Dhan real exports (with preamble)", () => {
  it("imports the transaction report — buy/sell legs and F&O", async () => {
    const cookie = await signup("dr1");
    const pid = await mkPortfolio(cookie);
    const prev = (await post("/api/imports/check", cookie, { portfolioId: pid, broker: "dhan-txn", filename: "t.csv", content: DHAN_TXN })).json();
    expect(prev.valid).toBe(4); // RIL buy + RIL sell + F&O buy + F&O sell (footer row rejected)
    expect(prev.invalid).toBe(1); // "Net P&L" total row
    await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "dhan-txn", filename: "t.csv", content: DHAN_TXN });

    const h = (await get("/api/holdings", cookie)).json();
    const ril = h.holdings.find((r: { security: { symbol: string } }) => r.security.symbol === "RELIANCE INDUSTRIES");
    expect(ril.netQty).toBe("6"); // 10 − 4
    expect(ril.avgCost).toBe("1200.1"); // (12000 + ₹1 charge) / 10
  });

  it("imports funds as deposits/withdrawals (skips failed)", async () => {
    const cookie = await signup("dr2");
    const pid = await mkPortfolio(cookie);
    const prev = (await post("/api/imports/check", cookie, { portfolioId: pid, broker: "funds", filename: "f.csv", content: DHAN_FUNDS })).json();
    expect(prev.toImport).toBe(2); // deposit + withdrawal; the FAILED row is dropped
    await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "funds", filename: "f.csv", content: DHAN_FUNDS });

    const h = (await get("/api/holdings", cookie)).json();
    expect(h.cashTracked).toBe(true);
    expect(h.summary.cash).toBe("40000"); // 50000 − 10000
  });

  it("imports dividends", async () => {
    const cookie = await signup("dr3");
    const pid = await mkPortfolio(cookie);
    await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "dividends", filename: "d.csv", content: DHAN_DIV });
    const d = (await get("/api/dividends", cookie)).json();
    expect(d.total).toBe("6120"); // 5200 + 920
    expect(d.count).toBe(2);
  });

  it("overwrites an overlapping period instead of duplicating (replace)", async () => {
    const cookie = await signup("dr4");
    const pid = await mkPortfolio(cookie);
    const payload = { portfolioId: pid, broker: "funds", filename: "f.csv", content: DHAN_FUNDS, from: "2025-04-01", to: "2026-03-31", replace: true };
    await post("/api/imports/commit", cookie, payload);
    const again = (await post("/api/imports/commit", cookie, payload)).json();
    expect(again.replaced).toBe(2); // cleared the two prior rows first
    expect(again.imported).toBe(2); // re-inserted fresh — no duplicates
    expect((await get("/api/holdings", cookie)).json().summary.cash).toBe("40000");
  });
});
