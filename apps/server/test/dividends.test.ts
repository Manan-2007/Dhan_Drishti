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

describe("GET /api/dividends", () => {
  it("rolls dividend & interest income up by FY and security", async () => {
    const cookie = await signup("div1");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "ITC", name: "ITC", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2023-04-01", quantity: "100", price: "400" });
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "dividend", tradeDate: "2023-09-01", grossAmount: "250" });
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "dividend", tradeDate: "2024-09-01", grossAmount: "300" });
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "interest", tradeDate: "2024-10-01", grossAmount: "50" });

    const res = await get("/api/dividends", cookie);
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.total).toBe("600"); // 250 + 300 + 50
    expect(d.count).toBe(3);
    expect(d.events).toHaveLength(3);
    expect(d.fxComplete).toBe(true);
    const fy2324 = d.byFY.find((f: { key: string }) => f.key === "FY 23-24");
    const fy2425 = d.byFY.find((f: { key: string }) => f.key === "FY 24-25");
    expect(fy2324.amount).toBe("250");
    expect(fy2425.amount).toBe("350"); // 300 dividend + 50 interest
    expect(d.bySecurity[0].symbol).toBe("ITC");
    expect(d.bySecurity[0].amount).toBe("600");
  });

  it("returns an empty, honest shape when there is no income", async () => {
    const cookie = await signup("div2");
    const res = await get("/api/dividends", cookie);
    expect(res.json().count).toBe(0);
    expect(res.json().total).toBe("0");
    expect(res.json().events).toEqual([]);
    expect(res.json().income.ttm).toBe("0");
    expect(res.json().upcoming).toEqual([]);
  });

  it("derives trailing-12-month income and an estimated cadence for held payers", async () => {
    const cookie = await signup("div3");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "POWERGRID", name: "Power Grid", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2022-01-01", quantity: "100", price: "200" });
    // Three recent, roughly-quarterly payouts (relative to today, so they fall inside the TTM window).
    const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "dividend", tradeDate: iso(200), grossAmount: "300" });
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "dividend", tradeDate: iso(110), grossAmount: "300" });
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "dividend", tradeDate: iso(20), grossAmount: "300" });

    const d = (await get("/api/dividends", cookie)).json();
    expect(d.income.ttm).toBe("900"); // all three within the trailing 12 months
    expect(d.upcoming).toHaveLength(1);
    const u = d.upcoming[0];
    expect(u.security.symbol).toBe("POWERGRID");
    expect(u.cadence).toBe("quarterly");
    expect(u.paymentsObserved).toBe(3);
    expect(u.ttm).toBe("900");
    expect(u.estimatedNext).not.toBeNull();
    expect(u.estimatedNext > iso(0)).toBe(true); // the estimate is in the future
  });
});
