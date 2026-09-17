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

beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db);
  await app.ready();
});

describe("corporate actions — stock split", () => {
  it("scales quantity by the ratio and lowers average cost, cost basis unchanged", async () => {
    const cookie = await signup("split1");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "MRF", name: "MRF", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-01-01", quantity: "10", price: "1000" });
    // 1:5 split — ratio in `price`.
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "split", tradeDate: "2024-02-01", price: "5" });

    const h = (await get("/api/holdings", cookie)).json();
    const row = h.holdings[0];
    expect(row.netQty).toBe("50"); // 10 × 5
    expect(row.invested).toBe("10000"); // unchanged
    expect(row.avgCost).toBe("200"); // 1000 → 200
  });

  it("rejects a split without a positive ratio", async () => {
    const cookie = await signup("split2");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security.id;
    const res = await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "split", tradeDate: "2024-02-01" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("split_ratio_required");
  });
});
