import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { createDb, type DB } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import { transactions } from "../src/db/schema.js";
import { convertLegacyStatements } from "../src/import/snapshot.js";

// A holdings statement is checked against the trades, never added on top of them.

const TRADEBOOK = [
  "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time",
  "INFY,INE009A01021,2025-04-02,NSE,EQ,EQ,buy,false,10,1500,9001,8001,2025-04-02T09:30:00",
  "TCS,INE467B01029,2025-05-02,NSE,EQ,EQ,sell,false,5,3600,9002,8002,2025-05-02T10:00:00",
  "WIPRO,INE075A01022,2025-06-02,NSE,EQ,EQ,buy,false,20,250,9003,8003,2025-06-02T10:00:00",
].join("\n");

// Holds INFY as the trades say, 10 TCS (15 bought before the tradebook, 5 sold in it), 40 ITC
// never traded in it, and no WIPRO (sold since).
const HOLDINGS = [
  "Instrument,ISIN,Qty.,Avg. cost,LTP",
  "INFY,INE009A01021,10,1500,1600",
  "TCS,INE467B01029,10,3000,3700",
  "ITC,INE154A01025,40,400,420",
].join("\n");

let db: DB;
let app: FastifyInstance;
async function signup(u: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: u, password: "supersecret1" } });
  const raw = res.headers["set-cookie"];
  return (Array.isArray(raw) ? raw[0]! : (raw as string)).split(";")[0]!;
}
const post = (url: string, cookie: string, payload?: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });

beforeEach(async () => {
  ({ db } = await createDb(":memory:"));
  app = buildApp(db);
  await app.ready();
});

const acct = { newAccount: { newPortfolioName: "Dad", broker: "zerodha", accountRef: "AB1234", name: "Zerodha" } };
const tradebook = (target: unknown = acct) => ({ filename: "tradebook-AB1234-EQ.csv", content: TRADEBOOK, kind: "transactions", adapter: "zerodha", target });
const holdings = (target: unknown = acct) => ({ filename: "holdings-AB1234.csv", content: HOLDINGS, kind: "transactions", adapter: "holdings", target });

async function positions(cookie: string) {
  const h = (await get("/api/holdings", cookie)).json().holdings as { security: { symbol: string }; netQty: string; realisedPnl: string }[];
  return Object.fromEntries(h.filter((x) => x.netQty !== "0").map((x) => [x.security.symbol, x.netQty]));
}

describe("holdings statements", () => {
  it("adds only what the trades don't explain, and reports what the statement doesn't list", async () => {
    const cookie = await signup("snap1");
    const res = await post("/api/imports/commit-many", cookie, { items: [holdings(), tradebook()] });
    expect(res.statusCode).toBe(201);
    // WIPRO stays as the trades say: a statement can be partial, so it's reported, not removed.
    expect(await positions(cookie)).toEqual({ INFY: "10", TCS: "10", ITC: "40", WIPRO: "20" });
    const file = res.json().files[0];
    expect(file.snapshot).toMatchObject({ opening: 2, reduced: 0, notInStatement: ["WIPRO"] });
    expect(file.imported).toBe(2);
  });

  it("dates the opening balance before the trade history, so earlier sales book real profit", async () => {
    const cookie = await signup("snap2");
    await post("/api/imports/commit-many", cookie, { items: [tradebook(), holdings()] });
    const txs = (await get("/api/transactions?limit=50", cookie)).json().transactions as { type: string; tradeDate: string; quantity: string; security: { symbol: string } | null }[];
    const opening = txs.find((t) => t.security?.symbol === "TCS" && t.type === "buy")!;
    expect(opening).toMatchObject({ quantity: "15", tradeDate: "2025-04-01T00:00:00.000Z" });
    const tcs = ((await get("/api/holdings", cookie)).json().holdings as { security: { symbol: string }; realisedPnl: string }[]).find((h) => h.security.symbol === "TCS")!;
    expect(tcs.realisedPnl).toBe("3000"); // 5 × (3600 − 3000), not an unexplained short
  });

  it("gives the same ledger whichever arrives first, even in separate imports", async () => {
    const a = await signup("snap3a");
    await post("/api/imports/commit-many", a, { items: [holdings()] });
    const accountId = (await get("/api/accounts", a)).json().accounts[0].id;
    await post("/api/imports/commit-many", a, { items: [tradebook({ accountId })] });

    const b = await signup("snap3b");
    await post("/api/imports/commit-many", b, { items: [tradebook()] });
    const accountB = (await get("/api/accounts", b)).json().accounts[0].id;
    await post("/api/imports/commit-many", b, { items: [holdings({ accountId: accountB })] });

    expect(await positions(a)).toEqual(await positions(b));
    expect(await positions(a)).toEqual({ INFY: "10", TCS: "10", ITC: "40", WIPRO: "20" });
  });

  it("moves out what the statement no longer shows, at cost — no invented profit", async () => {
    const cookie = await signup("snap4");
    await post("/api/imports/commit-many", cookie, { items: [tradebook()] });
    const accountId = (await get("/api/accounts", cookie)).json().accounts[0].id;
    const fewer = ["Instrument,ISIN,Qty.,Avg. cost,LTP", "INFY,INE009A01021,4,1500,1600", "WIPRO,INE075A01022,20,250,260"].join("\n");
    const res = await post("/api/imports/commit-many", cookie, { items: [{ filename: "h.csv", content: fewer, kind: "transactions", adapter: "holdings", target: { accountId } }] });
    expect(res.json().files[0].snapshot).toMatchObject({ opening: 0, reduced: 1 });
    const infy = ((await get("/api/holdings", cookie)).json().holdings as { security: { symbol: string }; netQty: string; realisedPnl: string }[]).find((h) => h.security.symbol === "INFY")!;
    expect(infy).toMatchObject({ netQty: "4", realisedPnl: "0" });
  });

  it("re-importing the same statement changes nothing, and the drop screen says so", async () => {
    const cookie = await signup("snap5");
    await post("/api/imports/commit-many", cookie, { items: [tradebook(), holdings()] });
    const again = (await post("/api/imports/detect", cookie, { filename: "zerodha-holdings-AB1234.csv", content: HOLDINGS })).json().detection;
    expect(again).toMatchObject({ snapshot: true, counts: { toImport: 0 } });
    const accountId = (await get("/api/accounts", cookie)).json().accounts[0].id;
    const before = (await get("/api/transactions?limit=100", cookie)).json().total;
    await post("/api/imports/commit-many", cookie, { items: [holdings({ accountId })] });
    expect((await get("/api/transactions?limit=100", cookie)).json().total).toBe(before);
    expect(await positions(cookie)).toEqual({ INFY: "10", TCS: "10", ITC: "40", WIPRO: "20" });
  });

  it("re-derives after a trade is added by hand, and won't let a derived row be edited", async () => {
    const cookie = await signup("snap6");
    await post("/api/imports/commit-many", cookie, { items: [tradebook(), holdings()] });
    const { accounts } = (await get("/api/accounts", cookie)).json();
    const account = accounts[0];
    const txs = (await get("/api/transactions?limit=100", cookie)).json().transactions as { id: string; type: string; quantity: string; security: { id: string; symbol: string } | null }[];
    const itc = txs.find((t) => t.security?.symbol === "ITC")!;
    // The ITC statement row came from the holdings file → locked.
    expect((await app.inject({ method: "DELETE", url: `/api/transactions/${itc.id}`, headers: { cookie } })).statusCode).toBe(400);
    // A forgotten ITC purchase from before the statement is entered: the opening balance shrinks to match.
    await post("/api/transactions", cookie, { portfolioId: account.portfolioId, accountId: account.id, securityId: itc.security!.id, type: "buy", tradeDate: "2025-08-01", quantity: "15", price: "410" });
    expect((await positions(cookie)).ITC).toBe("40");
  });

  it("converts statements imported before snapshots existed", async () => {
    const cookie = await signup("snap7");
    await post("/api/imports/commit-many", cookie, { items: [tradebook()] });
    const account = (await get("/api/accounts", cookie)).json().accounts[0];
    const infy = ((await get("/api/transactions?limit=50", cookie)).json().transactions as { security: { id: string; symbol: string } | null }[]).find((t) => t.security?.symbol === "INFY")!.security!.id;
    // The old importer's output: the statement's INFY written as a buy dated to the import.
    const userId = (await get("/api/auth/me", cookie)).json().user.id;
    await db.insert(transactions).values({ id: randomUUID(), userId, portfolioId: account.portfolioId, accountId: account.id, securityId: infy, type: "buy", tradeDate: "2026-09-20T10:00:00.000Z", quantity: "10", price: "1500", grossAmount: "15000", sourceBroker: "zerodha-holdings" }).run();
    expect((await positions(cookie)).INFY).toBe("20"); // double-counted

    expect(await convertLegacyStatements(db)).toBe(1);
    expect((await positions(cookie)).INFY).toBe("10");
    expect(await convertLegacyStatements(db)).toBe(0); // once
  });
});
