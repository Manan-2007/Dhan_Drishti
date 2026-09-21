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

describe("GET /api/reports/capital-gains", () => {
  it("classifies long- vs short-term gains (FIFO) and totals them", async () => {
    const cookie = await signup("cg1");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const eq = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security.id;
    // Long-term: bought 2022-01-01, sold 2023-06-01 (>12 months) → gain 5000.
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: eq, type: "buy", tradeDate: "2022-01-01", quantity: "100", price: "100" });
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: eq, type: "sell", tradeDate: "2023-06-01", quantity: "100", price: "150" });
    // Short-term: a separate lot bought and sold within a year → gain 1000.
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: eq, type: "buy", tradeDate: "2023-07-01", quantity: "50", price: "200" });
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: eq, type: "sell", tradeDate: "2023-12-01", quantity: "50", price: "220" });

    const r = (await get("/api/reports/capital-gains", cookie)).json();
    expect(r.rows).toHaveLength(2);
    expect(r.totals.longTerm.gain).toBe("5000");
    expect(r.totals.shortTerm.gain).toBe("1000");
    const long = r.rows.find((x: { term: string }) => x.term === "long");
    expect(long.symbol).toBe("TCS");
    expect(long.proceeds).toBe("15000");
    expect(r.fyList.length).toBeGreaterThanOrEqual(1);
    expect(typeof r.disclaimer).toBe("string");
  });

  it("returns empty totals when there are no sales", async () => {
    const cookie = await signup("cg2");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const eq = (await post("/api/securities", cookie, { symbol: "INFY", name: "Infosys", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: eq, type: "buy", tradeDate: "2023-01-01", quantity: "10", price: "100" });
    const r = (await get("/api/reports/capital-gains", cookie)).json();
    expect(r.rows).toEqual([]);
    expect(r.totals.longTerm.gain).toBe("0");
    expect(r.totals.shortTerm.gain).toBe("0");
  });

  it("excludes F&O (business income, not capital gains)", async () => {
    const cookie = await signup("cg3");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const fut = (await post("/api/securities", cookie, { symbol: "NIFTYFUT", name: "Nifty Future", assetClass: "other" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: fut, type: "buy", tradeDate: "2023-01-01", quantity: "50", price: "100", segment: "fno" });
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: fut, type: "sell", tradeDate: "2023-02-01", quantity: "50", price: "120", segment: "fno" });
    const r = (await get("/api/reports/capital-gains", cookie)).json();
    expect(r.rows).toEqual([]);
  });
});
