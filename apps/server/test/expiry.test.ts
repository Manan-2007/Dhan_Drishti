import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb, type DB } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import { refreshExpirySettlements } from "../src/import/expiry.js";
import type { BenchmarkBar, BenchmarkProvider } from "../src/market/types.js";

// Expired contracts the files never close are settled at the exchange's price that day.

class FakeIndex implements BenchmarkProvider {
  id = "fake-index";
  calls: string[] = [];
  constructor(private bars: Record<string, BenchmarkBar[]>) {}
  async getHistory(symbol: string, fromISO: string, toISO: string): Promise<BenchmarkBar[]> {
    this.calls.push(symbol);
    return (this.bars[symbol] ?? []).filter((b) => b.date >= fromISO.slice(0, 10) && b.date <= toISO.slice(0, 10));
  }
}

// NIFTY closes 25,200 on Thu 26 Jun 2025 (June's expiry). 29 May 2025 (May's) is treated as a
// holiday here: the last bar is the 28th, so the contract settles on that close.
const NIFTY = {
  "^NSEI": [
    { date: "2025-05-27", close: 24800 },
    { date: "2025-05-28", close: 24750 },
    { date: "2025-06-25", close: 25100 },
    { date: "2025-06-26", close: 25200 },
  ],
};

const HEAD = "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time";
const row = (sym: string, date: string, side: "buy" | "sell", qty: number, price: number, id: number, segment = "FO") =>
  `${sym},,${date},NFO,${segment},,${side},false,${qty},${price},${id},${id},${date}T10:00:00`;

const TRADEBOOK = [
  HEAD,
  row("NIFTY25JUN25000CE", "2025-06-02", "buy", 75, 100, 1), // in the money at 25,200 → worth 200
  row("NIFTY25JUN24000PE", "2025-06-02", "sell", 75, 50, 2), // short put, out of the money → bought back at 0
  row("NIFTY25JUN26000CE", "2025-06-03", "buy", 75, 20, 3), // out of the money → worthless
  row("NIFTY25MAY24500CE", "2025-05-05", "buy", 75, 90, 4), // settles on the 28th (holiday on the 29th)
  row("NIFTY27JAN30000CE", "2025-06-03", "buy", 75, 10, 5), // not expired yet
  row("GOLDM25JUNFUT", "2025-06-03", "buy", 1, 95000, 6, "MCX"), // no public price source
].join("\n");

let db: DB;
let app: FastifyInstance;
async function signup(u: string): Promise<{ cookie: string; userId: string }> {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: u, password: "supersecret1" } });
  const raw = res.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0]! : (raw as string)).split(";")[0]!;
  return { cookie, userId: res.json().user.id };
}
const post = (url: string, cookie: string, payload?: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });

beforeEach(async () => {
  ({ db } = await createDb(":memory:"));
  app = buildApp(db);
  await app.ready();
});

async function holdingsBySymbol(cookie: string) {
  const h = (await get("/api/holdings", cookie)).json().holdings as { security: { symbol: string }; netQty: string; realisedPnl: string }[];
  return Object.fromEntries(h.map((x) => [x.security.symbol, { qty: x.netQty, realised: x.realisedPnl }]));
}

describe("expiry settlement", () => {
  it("settles expired contracts at the exchange price, and leaves the rest alone", async () => {
    const { cookie, userId } = await signup("exp1");
    await post("/api/imports/commit-many", cookie, {
      items: [{ filename: "tradebook-AB1234-FO.csv", content: TRADEBOOK, kind: "transactions", adapter: "zerodha", target: { newAccount: { newPortfolioName: "Dad", broker: "zerodha", accountRef: "AB1234", name: "Zerodha" } } }],
    });
    const index = new FakeIndex(NIFTY);
    const r = await refreshExpirySettlements(db, userId, index);
    expect(r).toMatchObject({ settled: 4, unpriceable: 1, missing: [] });
    expect(index.calls.every((s) => s === "^NSEI")).toBe(true); // only the public index symbol leaves

    const h = await holdingsBySymbol(cookie);
    expect(h["NIFTY25JUN25000CE"]).toEqual({ qty: "0", realised: "7500" }); // 75 × (200 − 100)
    expect(h["NIFTY25JUN24000PE"]).toEqual({ qty: "0", realised: "3750" }); // kept the whole premium
    expect(h["NIFTY25JUN26000CE"]).toEqual({ qty: "0", realised: "-1500" }); // lost the whole premium
    expect(h["NIFTY25MAY24500CE"]).toEqual({ qty: "0", realised: "12000" }); // 75 × (24,750 − 24,500 − 90)
    expect(h["NIFTY27JAN30000CE"]!.qty).toBe("75");
    expect(h["GOLDM25JUNFUT"]!.qty).toBe("1");

    const txs = (await get("/api/transactions?limit=50", cookie)).json().transactions as { sourceBroker: string; tradeDate: string; security: { symbol: string } }[];
    const may = txs.find((t) => t.sourceBroker === "expiry" && t.security.symbol === "NIFTY25MAY24500CE")!;
    expect(may.tradeDate).toBe("2025-05-28T10:00:00.000Z");
  });

  it("gives way to a real closing trade entered later, and can't be edited by hand", async () => {
    const { cookie, userId } = await signup("exp2");
    await post("/api/imports/commit-many", cookie, {
      items: [{ filename: "tradebook-AB1234-FO.csv", content: TRADEBOOK, kind: "transactions", adapter: "zerodha", target: { newAccount: { newPortfolioName: "Dad", broker: "zerodha", accountRef: "AB1234", name: "Zerodha" } } }],
    });
    await refreshExpirySettlements(db, userId, new FakeIndex(NIFTY));
    const txs = (await get("/api/transactions?limit=50", cookie)).json().transactions as { id: string; portfolioId: string; accountId: string; sourceBroker: string; security: { id: string; symbol: string } }[];
    const settled = txs.find((t) => t.sourceBroker === "expiry" && t.security.symbol === "NIFTY25JUN25000CE")!;
    expect((await app.inject({ method: "DELETE", url: `/api/transactions/${settled.id}`, headers: { cookie } })).statusCode).toBe(400);

    // The call was actually sold before expiry — the real trade replaces the estimate.
    await post("/api/transactions", cookie, { portfolioId: settled.portfolioId, accountId: settled.accountId, securityId: settled.security.id, type: "sell", tradeDate: "2025-06-20", quantity: "75", price: "150", segment: "fno" });
    const h = await holdingsBySymbol(cookie);
    expect(h["NIFTY25JUN25000CE"]).toEqual({ qty: "0", realised: "3750" }); // 75 × (150 − 100), no settlement
    const after = (await get("/api/transactions?limit=50", cookie)).json().transactions as { sourceBroker: string; security: { symbol: string } }[];
    expect(after.filter((t) => t.sourceBroker === "expiry" && t.security.symbol === "NIFTY25JUN25000CE")).toHaveLength(0);
  });

  it("works offline once prices are cached, and re-settles on the next import", async () => {
    const { cookie, userId } = await signup("exp3");
    const target = { newAccount: { newPortfolioName: "Dad", broker: "zerodha", accountRef: "AB1234", name: "Zerodha" } };
    await post("/api/imports/commit-many", cookie, { items: [{ filename: "tradebook-AB1234-FO.csv", content: TRADEBOOK, kind: "transactions", adapter: "zerodha", target }] });
    await refreshExpirySettlements(db, userId, new FakeIndex(NIFTY));
    // Another import (nothing new for these contracts) re-derives from the cache: still settled.
    const accountId = (await get("/api/accounts", cookie)).json().accounts[0].id;
    await post("/api/imports/commit-many", cookie, {
      items: [{ filename: "tradebook-AB1234-EQ.csv", content: [HEAD, row("INFY", "2025-06-02", "buy", 1, 1500, 99, "EQ")].join("\n"), kind: "transactions", adapter: "zerodha", target: { accountId } }],
    });
    expect((await holdingsBySymbol(cookie))["NIFTY25JUN25000CE"]).toEqual({ qty: "0", realised: "7500" });
  });
});
