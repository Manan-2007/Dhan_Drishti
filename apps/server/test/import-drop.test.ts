import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";

// Synthetic files that copy real broker layouts (preamble rows, headers) with made-up people,
// codes and numbers — real exports carry names, phone numbers and emails, so they never live here.
const ZERODHA_TRADEBOOK = [
  "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time",
  "INFY,INE009A01021,2025-04-02,NSE,EQ,EQ,buy,false,10.000000,1500.000000,9001,8001,2025-04-02T09:30:00",
  "TCS,INE467B01029,2025-04-03,NSE,EQ,EQ,buy,false,5.000000,3500.000000,9002,8002,2025-04-03T10:00:00",
].join("\n");

const DHAN_REPORT = [
  "Global transction report,From 01-04-2025 to 31-03-2026",
  "Name,TEST PERSON",
  "UCC,XYZ12345",
  "Mobile,0000000000",
  "",
  "Date,Scrip Name,Exchange,Bill No.,Buy Qty.,Buy Value,Sell Qty.,Sell Value,Brokerage,GST,STT,SEBI Fees,Stamp Duty,Txn. Charges,Oth. Charges,Gross Amount",
  '"01 Apr 2025 00:00:00","Reliance Industries (RELIANCE)","NSE","11","10","12400.00","0","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","-12400.00"',
].join("\n");

const DHAN_HOLDING = [
  "Holding summary,For 17-09-2026",
  "Name,TEST PERSON",
  "UCC,XYZ12345",
  "",
  "Scrip Name,ISIN Code,Free Holding,Locked In,Safe Keep,MTF Pledge,Margin Pledge,CUSA Pledge,Closing Price,Valuation",
  '"Reliance Industries","INE002A01018","10.00","0.00","0.00","0.00","0.00","0.00","1300.00","13000.00"',
].join("\n");

const DHAN_PNL = [
  "Realised PnL Report,From 01-04-2025 to 31-03-2026",
  "Name,TEST PERSON",
  "UCC,XYZ12345",
  "",
  "Scrip Name,ISIN Code,Quantity,Avg. Buy Price,Buy Value,Avg. Sell Price,Sell Value,Realised P&L,Realised P&L %",
  '"Some Stock","INE000000000","5","100.00","500.00","110.00","550.00","50.00","10.00"',
].join("\n");

let app: FastifyInstance;
async function signup(u: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: u, password: "supersecret1" } });
  const raw = res.headers["set-cookie"];
  return (Array.isArray(raw) ? raw[0]! : (raw as string)).split(";")[0]!;
}
const post = (url: string, cookie: string, payload?: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
const detect = async (cookie: string, filename: string, content: string) => (await post("/api/imports/detect", cookie, { filename, content })).json().detection;

beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db);
  await app.ready();
});

describe("POST /api/imports/detect", () => {
  it("identifies a Zerodha tradebook and reads the client ID from its file name", async () => {
    const cookie = await signup("drop-z");
    const d = await detect(cookie, "Eq tradebook-AB1234-EQ.csv", ZERODHA_TRADEBOOK);
    expect(d).toMatchObject({ kind: "transactions", adapter: "zerodha", brokerFamily: "zerodha", accountRef: "AB1234", currency: "INR" });
    expect(d.counts).toMatchObject({ rowsTotal: 2, toImport: 2, duplicates: 0 });
    expect(d.counts.period.from.slice(0, 10)).toBe("2025-04-02");
    expect(d.suggestion).toBeNull(); // no accounts yet
  });

  it("reads the client code and holder from a Dhan report's preamble, and nothing else", async () => {
    const cookie = await signup("drop-d");
    const d = await detect(cookie, "All Transction_Report.csv", DHAN_REPORT);
    expect(d).toMatchObject({ kind: "transactions", adapter: "dhan-txn", brokerFamily: "dhan", accountRef: "XYZ12345", holderName: "TEST PERSON" });
    expect(JSON.stringify(d)).not.toContain("0000000000"); // the phone number is never surfaced
  });

  it("routes a holdings snapshot to prices only, never the ledger", async () => {
    const cookie = await signup("drop-h");
    const d = await detect(cookie, "Holding_17-09-2026.csv", DHAN_HOLDING);
    expect(d).toMatchObject({ kind: "prices", adapter: null, priceRows: 1 });
  });

  it("takes a broker P&L report as a cross-check for that account", async () => {
    const cookie = await signup("drop-p");
    expect(await detect(cookie, "Realised_P&L.csv", DHAN_PNL)).toMatchObject({ kind: "pnl_report", brokerFamily: "dhan", accountRef: "XYZ12345" });
  });

  it("says plainly when it doesn't know a file", async () => {
    const cookie = await signup("drop-u");
    expect(await detect(cookie, "notes.csv", "foo,bar,baz\n1,2,3\n4,5,6")).toMatchObject({ kind: "unrecognized", adapter: null });
  });
});

describe("POST /api/imports/commit-many", () => {
  it("imports a whole drop at once, creating the person and accounts, and reports what changed", async () => {
    const cookie = await signup("drop-c1");
    const res = await post("/api/imports/commit-many", cookie, {
      items: [
        { filename: "tradebook-AB1234-EQ.csv", content: ZERODHA_TRADEBOOK, kind: "transactions", adapter: "zerodha", target: { newAccount: { newPortfolioName: "Dad", broker: "zerodha", accountRef: "AB1234", name: "Zerodha · AB1234" } } },
        { filename: "All Transction_Report.csv", content: DHAN_REPORT, kind: "transactions", adapter: "dhan-txn", target: { newAccount: { newPortfolioName: "Dad", broker: "dhan", accountRef: "XYZ12345", name: "Dhan · XYZ12345" } } },
        { filename: "Holding.csv", content: DHAN_HOLDING, kind: "prices" },
      ],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.files.map((f: { imported: number }) => f.imported)).toEqual([2, 1, 0]);
    expect(body.files[2].prices.seeded).toBe(1); // the snapshot priced the Reliance bought in the same drop
    expect(body.before.openPositions).toBe(0);
    expect(body.after.openPositions).toBe(3);

    const portfolios = (await get("/api/portfolios", cookie)).json().portfolios;
    expect(portfolios.map((p: { name: string }) => p.name)).toEqual(["Dad"]); // one person, not two
    const accounts = (await get("/api/accounts", cookie)).json().accounts;
    expect(accounts).toHaveLength(2);

    // Next time, the same client code is recognised automatically.
    const again = await detect(cookie, "tradebook-AB1234-EQ.csv", ZERODHA_TRADEBOOK);
    expect(again.suggestion).toMatchObject({ portfolioName: "Dad", why: "Client code AB1234" });
    expect(again.counts).toMatchObject({ duplicates: 2, toImport: 0 }); // and nothing would double up
  });

  it("is all-or-nothing: one bad file writes nothing, not even the new person", async () => {
    const cookie = await signup("drop-c2");
    const res = await post("/api/imports/commit-many", cookie, {
      items: [
        { filename: "tradebook-AB1234-EQ.csv", content: ZERODHA_TRADEBOOK, kind: "transactions", adapter: "zerodha", target: { newAccount: { newPortfolioName: "Mom", broker: "zerodha", accountRef: "AB1234", name: "Zerodha" } } },
        { filename: "other.csv", content: ZERODHA_TRADEBOOK, kind: "transactions", adapter: "zerodha", target: { accountId: "does-not-exist" } },
      ],
    });
    expect(res.statusCode).toBe(404);
    expect((await get("/api/transactions", cookie)).json().total).toBe(0);
    expect((await get("/api/portfolios", cookie)).json().portfolios).toHaveLength(0);
  });

  it("matches an existing account that has no client code yet, and teaches it the code", async () => {
    const cookie = await signup("drop-c5");
    const pid = (await post("/api/portfolios", cookie, { name: "Dad" })).json().portfolio.id;
    const acc = (await post("/api/accounts", cookie, { portfolioId: pid, name: "Zerodha", broker: "zerodha" })).json().account;

    const d = await detect(cookie, "tradebook-AB1234-EQ.csv", ZERODHA_TRADEBOOK);
    expect(d.suggestion).toMatchObject({ accountId: acc.id, why: "Your only zerodha account", adoptRef: "AB1234" });

    const res = await post("/api/imports/commit-many", cookie, {
      items: [{ filename: "tradebook-AB1234-EQ.csv", content: ZERODHA_TRADEBOOK, kind: "transactions", adapter: "zerodha", target: { accountId: acc.id, adoptRef: d.suggestion.adoptRef } }],
    });
    expect(res.statusCode).toBe(201);
    expect((await get(`/api/accounts/${acc.id}`, cookie)).json().account.accountRef).toBe("AB1234");
    expect((await detect(cookie, "tradebook-AB1234-EQ.csv", ZERODHA_TRADEBOOK)).suggestion).toMatchObject({ why: "Client code AB1234", adoptRef: null });
  });

  it("asks for an owner instead of guessing", async () => {
    const cookie = await signup("drop-c3");
    const res = await post("/api/imports/commit-many", cookie, { items: [{ filename: "t.csv", content: ZERODHA_TRADEBOOK, kind: "transactions", adapter: "zerodha" }] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("account_required");
  });

  it("keeps both of an account's same-type files over the same dates (equity + F&O tradebooks), and a re-drop adds nothing", async () => {
    const cookie = await signup("drop-c6");
    const fno = [
      "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time,expiry_date",
      "NIFTY25JUN26000CE,,2025-04-02,NSE,FO,,buy,false,75.000000,38.150000,5001,4001,2025-04-02T09:23:33,2025-06-26",
      "NIFTY25JUN26000CE,,2025-04-10,NSE,FO,,sell,false,75.000000,40.000000,5002,4002,2025-04-10T09:23:33,2025-06-26",
    ].join("\n");
    const drop = {
      items: [
        { filename: "Eq tradebook-AB1234-EQ.csv", content: ZERODHA_TRADEBOOK, kind: "transactions", adapter: "zerodha", target: { newAccount: { newPortfolioName: "Dad", broker: "zerodha", accountRef: "AB1234", name: "Zerodha" } } },
        { filename: "FnO tradebook-AB1234-FO.csv", content: fno, kind: "transactions", adapter: "zerodha", target: { newAccount: { newPortfolioName: "Dad", broker: "zerodha", accountRef: "AB1234", name: "Zerodha" } } },
      ],
    };
    const res = await post("/api/imports/commit-many", cookie, drop);
    expect(res.statusCode).toBe(201);
    expect((await get("/api/transactions", cookie)).json().total).toBe(4); // 2 equity + 2 F&O, none wiped
    expect((await get("/api/accounts", cookie)).json().accounts).toHaveLength(1); // same code → same account
    expect((await detect(cookie, "Eq tradebook-AB1234-EQ.csv", ZERODHA_TRADEBOOK)).counts.toImport).toBe(0);
    expect((await detect(cookie, "FnO tradebook-AB1234-FO.csv", fno)).counts.toImport).toBe(0);
  });

  it("re-uploading one account's period never touches another account at the same broker", async () => {
    const cookie = await signup("drop-c4");
    const first = await post("/api/imports/commit-many", cookie, {
      items: [{ filename: "tradebook-AB1234-EQ.csv", content: ZERODHA_TRADEBOOK, kind: "transactions", adapter: "zerodha", target: { newAccount: { newPortfolioName: "Home", broker: "zerodha", accountRef: "AB1234", name: "Zerodha A" } } }],
    });
    expect(first.statusCode).toBe(201);
    // A second Zerodha account for the same person, same dates, different trades.
    const otherFile = ZERODHA_TRADEBOOK.replace(/900(\d)/g, "700$1").replace(/800(\d)/g, "600$1");
    const second = await post("/api/imports/commit-many", cookie, {
      items: [{ filename: "tradebook-CD5678-EQ.csv", content: otherFile, kind: "transactions", adapter: "zerodha", target: { newAccount: { newPortfolioName: "Home", broker: "zerodha", accountRef: "CD5678", name: "Zerodha B" } } }],
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().files[0]).toMatchObject({ imported: 2, replaced: 0 });
    expect((await get("/api/transactions", cookie)).json().total).toBe(4); // A's two trades survived
  });
});

// Dhan's statement drops some F&O exits; its P&L report still counts them.
const DHAN_FNO_TXN = [
  "Global transction report,From 01-04-2025 to 31-03-2026",
  "UCC,XYZ12345",
  "",
  "Date,Scrip Name,Exchange,Bill No.,Buy Qty.,Buy Value,Sell Qty.,Sell Value,Brokerage,GST,STT,SEBI Fees,Stamp Duty,Txn. Charges,Oth. Charges,Gross Amount",
  '"01 Apr 2025 00:00:00","Reliance Industries (RELIANCE)","NSE","1","10","12400.00","0","0.00","0","0","0","0","0","0","0","-12400.00"',
  '"07 Apr 2025 00:00:00","OPT NIFTY 26 Jun 2025 25000 CE","NSE","2","75","3750.00","0","0.00","0","0","0","0","0","0","0","-3750.00"',
  '"07 Apr 2025 00:00:00","OPT NIFTY 26 Jun 2025 21000 PE","NSE","2","30","300.00","0","0.00","0","0","0","0","0","0","0","-300.00"',
  '"09 Apr 2025 00:00:00","OPT NIFTY 29 May 2025 20800 PE","NSE","3","0","0.00","50","5000.00","0","0","0","0","0","0","0","5000.00"',
  '"02 May 2025 00:00:00","Reliance Industries (RELIANCE)","NSE","4","0","0.00","10","13000.00","0","0","0","0","0","0","0","13000.00"',
  '"11 Jun 2025 00:00:00","OPT NIFTY 26 Jun 2025 25000 CE","NSE","5","75","30000.00","75","29250.00","0","0","0","0","0","0","0","-750.00"',
].join("\n");

const DHAN_ALL_PNL = [
  "Realised PnL Report,From 01-04-2025 to 31-03-2026",
  "UCC,XYZ12345",
  "",
  "Scrip Name,Quantity,Avg. Buy Price,Buy Value,Avg. Sell Price,Sell Value,Realised P&L,Realised P&L %",
  '"Reliance Industries (RELIANCE)","10","1240.00","12400.00","1300.00","13000.00","600.00","4.84"',
  '"OPT NIFTY 26 Jun 2025 25000 CE","150","225.00","33750.00","295.00","44250.00","10500.00","31.11"',
  '"OPT NIFTY 29 May 2025 20800 PE","50","30.00","1500.00","100.00","5000.00","3500.00","233.33"',
  '"OPT NIFTY 26 Jun 2025 21000 PE","40","10.00","400.00","12.50","500.00","100.00","25.00"',
  "",
  "Net P&L,14700.00,Brokerage,0,Gross P&L,14700.00,Total Charges,0",
].join("\n");

describe("P&L report cross-check", () => {
  it("fills exits the statement missed — only where the numbers match exactly — and compares totals", async () => {
    const cookie = await signup("drop-pnl");
    const dhan = { newAccount: { newPortfolioName: "Dad", broker: "dhan", accountRef: "XYZ12345", name: "Dhan · XYZ12345" } };
    const res = await post("/api/imports/commit-many", cookie, {
      items: [
        { filename: "Realised_All_P&L.csv", content: DHAN_ALL_PNL, kind: "pnl_report", target: dhan },
        { filename: "All Transction_Report.csv", content: DHAN_FNO_TXN, kind: "transactions", adapter: "dhan-txn", target: dhan },
      ],
    });
    expect(res.statusCode).toBe(201);
    const r = res.json().files[0].reconcile;
    expect(r.filled).toEqual([
      { contract: "OPT NIFTY 26 Jun 2025 25000 CE", type: "sell", quantity: "75", price: "200.00", tradeDate: "2025-06-26T00:00:00.000Z" },
      { contract: "OPT NIFTY 29 May 2025 20800 PE", type: "buy", quantity: "50", price: "30.00", tradeDate: "2025-05-29T00:00:00.000Z" },
    ]);
    expect(r.unmatched).toBe(1); // 21000 PE: the report's 40 doesn't square with 30 held — left alone
    expect(r.check).toEqual({ broker: "14700.00", ours: "14600.00", difference: "-100.00", from: "2025-04-01", to: "2026-03-31", soldWithoutPurchase: 0, currency: "INR" });

    const holdings = (await get("/api/holdings", cookie)).json().holdings as { security: { symbol: string }; netQty: string }[];
    const qty = (sym: string) => holdings.find((h) => h.security.symbol === sym)?.netQty ?? "0";
    expect(qty("OPT NIFTY 26 JUN 2025 25000 CE")).toBe("0");
    expect(qty("OPT NIFTY 29 MAY 2025 20800 PE")).toBe("0");
    expect(qty("OPT NIFTY 26 JUN 2025 21000 PE")).toBe("30");

    // Dropping the report again changes nothing.
    const again = await post("/api/imports/commit-many", cookie, {
      items: [{ filename: "Realised_All_P&L.csv", content: DHAN_ALL_PNL, kind: "pnl_report", target: { accountId: res.json().files[0].accountId } }],
    });
    expect(again.json().files[0].reconcile.filled).toEqual([]);
  });

  it("explains a gap from shares bought before the files start", async () => {
    const cookie = await signup("drop-pnl2");
    const txn = [
      "Date,Scrip Name,Exchange,Bill No.,Buy Qty.,Buy Value,Sell Qty.,Sell Value,Brokerage,GST,STT,SEBI Fees,Stamp Duty,Txn. Charges,Oth. Charges,Gross Amount",
      '"05 May 2025 00:00:00","Trent (TRENT)","NSE","1","0","0.00","5","25000.00","0","0","0","0","0","0","0","25000.00"',
    ].join("\n");
    const pnl = [
      "Realised PnL Report,From 01-04-2025 to 31-03-2026",
      "",
      "Scrip Name,Quantity,Avg. Buy Price,Buy Value,Avg. Sell Price,Sell Value,Realised P&L,Realised P&L %",
      '"Trent (TRENT)","5","4000.00","20000.00","5000.00","25000.00","5000.00","25.00"',
      "",
      "Net P&L,5000.00,Brokerage,0,Gross P&L,5000.00,Total Charges,0",
    ].join("\n");
    const dhan = { newAccount: { newPortfolioName: "Dad", broker: "dhan", name: "Dhan" } };
    const res = await post("/api/imports/commit-many", cookie, {
      items: [
        { filename: "All Transction_Report.csv", content: txn, kind: "transactions", adapter: "dhan-txn", target: dhan },
        { filename: "Realised_All_P&L.csv", content: pnl, kind: "pnl_report", target: dhan },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().files[1].reconcile).toMatchObject({ filled: [], unmatched: 0, check: { broker: "5000.00", ours: "0.00", soldWithoutPurchase: 1 } });
    // Not a short worth −5 × price: the sale settles at day's end, nothing is held, nothing invented.
    const h = (await get("/api/holdings", cookie)).json();
    expect(h.summary.soldWithoutPurchase).toBe(1);
    const trent = h.holdings.find((x: { security: { symbol: string } }) => x.security.symbol === "TRENT");
    expect(trent).toMatchObject({ netQty: "0", realisedPnl: "0", soldWithoutPurchase: "5" });
  });
});
