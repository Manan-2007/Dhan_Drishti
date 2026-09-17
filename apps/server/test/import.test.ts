import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;

async function signup(username: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { username, password: "supersecret1" },
  });
  const raw = res.headers["set-cookie"];
  const line = Array.isArray(raw) ? raw[0]! : (raw as string);
  return line.split(";")[0]!;
}
const post = (url: string, cookie: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: { cookie }, payload });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });

// Real Zerodha console tradebook columns; last data row is intentionally invalid.
const CSV = [
  "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time",
  "FEDERALBNK,INE171A01029,2021-04-27,BSE,EQ,A,buy,false,50,74,T001,O001,2021-04-27T09:30:00",
  "FEDERALBNK,INE171A01029,2021-04-28,NSE,EQ,EQ,buy,false,30,75.5,T002,O002,2021-04-28T10:00:00",
  "SUNPHARMA,INE044A01036,2021-05-07,NSE,EQ,EQ,buy,false,10,680,T003,O003,2021-05-07T11:00:00",
  "FEDERALBNK,INE171A01029,2021-05-12,NSE,EQ,EQ,sell,false,80,82,T004,O004,2021-05-12T12:00:00",
  "BADROW,INE000000000,2021-05-13,NSE,EQ,EQ,transfer,false,10,,T005,O005,2021-05-13T12:00:00",
].join("\n");

beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db);
  await app.ready();
});

async function makePortfolio(cookie: string): Promise<string> {
  return (await post("/api/portfolios", cookie, { name: "Zerodha", kind: "broker" })).json().portfolio.id;
}

describe("Zerodha CSV import", () => {
  it("lists available brokers", async () => {
    const cookie = await signup("impuser");
    const res = await get("/api/imports/brokers", cookie);
    expect(res.json().brokers.map((b: { id: string }) => b.id)).toContain("zerodha");
  });

  it("previews without writing: classifies valid / invalid / new securities", async () => {
    const cookie = await signup("previewer");
    const portfolioId = await makePortfolio(cookie);
    const res = await post("/api/imports/check", cookie, {
      portfolioId,
      broker: "zerodha",
      filename: "tradebook.csv",
      content: CSV,
    });
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.rowsTotal).toBe(5);
    expect(p.invalid).toBe(1);
    expect(p.valid).toBe(4);
    expect(p.duplicates).toBe(0);
    expect(p.toImport).toBe(4);
    expect(p.newSecurities).toBe(2);
    expect(p.newSecuritySymbols).toEqual(expect.arrayContaining(["FEDERALBNK", "SUNPHARMA"]));
    expect(p.invalidRows[0].error).toMatch(/quantity|price|trade type/i);
    // Nothing persisted by a preview:
    expect((await get("/api/transactions", cookie)).json().total).toBe(0);
  });

  it("commits: creates securities + transactions, and holdings reflect the trades", async () => {
    const cookie = await signup("committer");
    const portfolioId = await makePortfolio(cookie);
    const res = await post("/api/imports/commit", cookie, {
      portfolioId,
      broker: "zerodha",
      filename: "tradebook.csv",
      content: CSV,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().imported).toBe(4);

    expect((await get("/api/transactions", cookie)).json().total).toBe(4);

    const holdings = (await get("/api/holdings", cookie)).json();
    const fed = holdings.holdings.find((h: { security: { symbol: string } }) => h.security.symbol === "FEDERALBNK");
    const sun = holdings.holdings.find((h: { security: { symbol: string } }) => h.security.symbol === "SUNPHARMA");
    expect(fed.netQty).toBe("0"); // 50 + 30 - 80
    expect(sun.netQty).toBe("10");
    expect(sun.invested).toBe("6800"); // 10 * 680

    // Import batch recorded.
    expect((await get("/api/imports", cookie)).json().imports).toHaveLength(1);
  });

  it("is idempotent: re-importing the same file adds zero rows", async () => {
    const cookie = await signup("idem");
    const portfolioId = await makePortfolio(cookie);
    const payload = { portfolioId, broker: "zerodha", filename: "tradebook.csv", content: CSV };
    await post("/api/imports/commit", cookie, payload);
    const second = await post("/api/imports/commit", cookie, payload);
    expect(second.json().imported).toBe(0);
    expect(second.json().duplicates).toBe(4);
    expect((await get("/api/transactions", cookie)).json().total).toBe(4);
  });

  it("keeps genuinely-identical rows without a trade_id, yet dedups on re-import", async () => {
    const cookie = await signup("notradeid");
    const portfolioId = await makePortfolio(cookie);
    // No trade_id column; two identical buy rows are both real trades.
    const csv = [
      "Symbol,ISIN,TradeDate,Exch,Seg,Series,TradeType,Qty,Price",
      "ITC,INE154A01025,2021-05-27,BSE,EQ,A,buy,25,211",
      "ITC,INE154A01025,2021-05-27,BSE,EQ,A,buy,25,211",
    ].join("\n");
    const payload = { portfolioId, broker: "zerodha", filename: "t.csv", content: csv };

    const first = await post("/api/imports/commit", cookie, payload);
    expect(first.json().imported).toBe(2); // both kept
    const holdings = (await get("/api/holdings", cookie)).json();
    expect(holdings.holdings[0].netQty).toBe("50");

    const second = await post("/api/imports/commit", cookie, payload);
    expect(second.json().imported).toBe(0); // same file → idempotent
    expect((await get("/api/transactions", cookie)).json().total).toBe(2);
  });

  it("rejects a file that isn't a recognizable Zerodha export", async () => {
    const cookie = await signup("badfmt");
    const portfolioId = await makePortfolio(cookie);
    const res = await post("/api/imports/check", cookie, {
      portfolioId,
      broker: "zerodha",
      filename: "notes.csv",
      content: "foo,bar,baz\n1,2,3",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("format_unrecognized");
  });
});
