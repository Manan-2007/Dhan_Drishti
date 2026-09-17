import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import type { MarketDataProvider, SecurityLike, QuoteData } from "../src/market/types.js";

class FakeProvider implements MarketDataProvider {
  id = "fake";
  constructor(private price: number) {}
  async getQuotes(s: SecurityLike[]): Promise<QuoteData[]> {
    return s.map((x) => ({ securityId: x.id, price: String(this.price), prevClose: null, currency: x.currency, asOf: "2024-06-01T00:00:00.000Z", provider: this.id }));
  }
}

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
  app = buildApp(db, { marketProvider: new FakeProvider(200) });
  await app.ready();
});

describe("goals", () => {
  it("creates a goal and computes progress from funding portfolios (invested basis)", async () => {
    const cookie = await signup("goal1");
    const pid = (await post("/api/portfolios", cookie, { name: "Retirement" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-01-01", quantity: "10", price: "100" });

    const res = await post("/api/goals", cookie, { name: "House", targetAmount: "4000", portfolioIds: [pid] });
    expect(res.statusCode).toBe(201);
    const g = res.json().goal;
    expect(g.funded).toBe("1000"); // invested, no prices yet
    expect(g.remaining).toBe("3000");
    expect(g.progress).toBe("0.25");
    expect(g.basis).toBe("invested");
    expect(g.reached).toBe(false);
    expect(g.portfolioIds).toEqual([pid]);
  });

  it("switches to market value after prices and marks reached", async () => {
    const cookie = await signup("goal2");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "INFY", name: "Infy", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-01-01", quantity: "10", price: "100" });
    await post("/api/market-data/refresh", cookie, {});

    const g = (await post("/api/goals", cookie, { name: "Small", targetAmount: "1500", portfolioIds: [pid] })).json().goal;
    expect(g.funded).toBe("2000"); // 10 * 200 (priced)
    expect(g.basis).toBe("current_value");
    expect(g.reached).toBe(true);
    expect(g.remaining).toBe("0");
  });

  it("computes required monthly contribution from a target date", async () => {
    const cookie = await signup("goal3");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "X", name: "X", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-01-01", quantity: "1", price: "1000" });
    const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const g = (await post("/api/goals", cookie, { name: "Car", targetAmount: "13000", targetDate: future, portfolioIds: [pid] })).json().goal;
    expect(Number(g.remaining)).toBe(12000);
    expect(g.monthsRemaining).toBeGreaterThanOrEqual(11);
    expect(Number(g.requiredMonthly)).toBeGreaterThan(0);
  });

  it("lists, updates and deletes goals, scoped to the user", async () => {
    const a = await signup("goalA");
    const gid = (await post("/api/goals", a, { name: "G", targetAmount: "100" })).json().goal.id;
    expect((await get("/api/goals", a)).json().goals).toHaveLength(1);

    const upd = await app.inject({ method: "PUT", url: `/api/goals/${gid}`, headers: { cookie: a }, payload: { targetAmount: "200" } });
    expect(upd.json().goal.targetAmount).toBe("200");

    const b = await signup("goalB");
    expect((await get(`/api/goals/${gid}`, b)).statusCode).toBe(404);

    const del = await app.inject({ method: "DELETE", url: `/api/goals/${gid}`, headers: { cookie: a } });
    expect(del.statusCode).toBe(200);
    expect((await get("/api/goals", a)).json().goals).toHaveLength(0);
  });
});
