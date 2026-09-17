import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createDb, type DB } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import { quotes } from "../src/db/schema.js";

let app: FastifyInstance;
let db: DB;

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

beforeEach(async () => {
  ({ db } = await createDb(":memory:"));
  app = buildApp(db);
  await app.ready();
});

describe("GET /api/holdings", () => {
  it("derives holdings + summary from the ledger without any prices", async () => {
    const cookie = await signup("hold1");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json()
      .security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-01-01", quantity: "10", price: "100" });
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-02-01", quantity: "10", price: "200" });

    const res = await get("/api/holdings", cookie);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.holdings).toHaveLength(1);
    expect(body.holdings[0].netQty).toBe("20");
    expect(body.holdings[0].avgCost).toBe("150");
    expect(body.holdings[0].currentValue).toBeNull(); // no quote → unknown, not faked
    expect(body.summary.invested).toBe("3000");
    expect(body.summary.allPriced).toBe(false);
    expect(body.allocation.basis).toBe("invested");
  });

  it("uses the latest quote to value positions and compute unrealised P&L", async () => {
    const cookie = await signup("hold2");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "INFY", name: "Infosys", assetClass: "equity" })).json()
      .security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-01-01", quantity: "10", price: "100" });

    // Seed an older and a newer quote; the engine must use the newer one.
    await db.insert(quotes).values({ id: randomUUID(), securityId: sid, price: "120", currency: "INR", asOf: "2024-03-01T00:00:00Z", provider: "test" }).run();
    await db.insert(quotes).values({ id: randomUUID(), securityId: sid, price: "150", prevClose: "140", currency: "INR", asOf: "2024-04-01T00:00:00Z", provider: "test" }).run();

    const body = (await get("/api/holdings", cookie)).json();
    expect(body.holdings[0].currentValue).toBe("1500");
    expect(body.holdings[0].unrealisedPnl).toBe("500");
    expect(body.holdings[0].todayChange).toBe("100");
    expect(body.summary.currentValue).toBe("1500");
    expect(body.summary.allPriced).toBe(true);
    expect(body.allocation.basis).toBe("current_value");
  });

  it("scopes holdings to the requesting user", async () => {
    const a = await signup("holdA");
    const pid = (await post("/api/portfolios", a, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", a, { symbol: "SBIN", name: "SBI", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", a, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-01-01", quantity: "5", price: "100" });

    const b = await signup("holdB");
    const body = (await get("/api/holdings", b)).json();
    expect(body.holdings).toHaveLength(0);
    expect(body.summary.invested).toBe("0");
  });
});
