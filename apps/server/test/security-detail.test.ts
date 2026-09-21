import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import type { MarketDataProvider, QuoteData, SecurityLike, SecurityHistoryProvider, BenchmarkBar } from "../src/market/types.js";

class FixedProvider implements MarketDataProvider {
  id = "fixed";
  constructor(private prices: Record<string, string>) {}
  async getQuotes(securities: SecurityLike[]): Promise<QuoteData[]> {
    return securities
      .filter((s) => this.prices[s.symbol])
      .map((s) => ({ securityId: s.id, price: this.prices[s.symbol]!, currency: "INR", asOf: new Date().toISOString(), provider: this.id }));
  }
}
class FakeHistory implements SecurityHistoryProvider {
  id = "fake-history";
  async getHistory(_s: SecurityLike, from: string, to: string): Promise<BenchmarkBar[]> {
    return [
      { date: from, close: 700 },
      { date: to, close: 900 },
    ];
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
  app = buildApp(db, { marketProvider: new FixedProvider({ TCS: "900" }), historyProvider: new FakeHistory() });
  await app.ready();
});

describe("GET /api/securities/:id/detail", () => {
  it("returns the position, transactions and price history for a held security", async () => {
    const cookie = await signup("sd1");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2023-01-01", quantity: "100", price: "700" });
    await post("/api/market-data/refresh", cookie, {}); // TCS → ₹900

    const r = (await get(`/api/securities/${sid}/detail`, cookie)).json();
    expect(r.security.symbol).toBe("TCS");
    expect(r.position).toBeTruthy();
    expect(r.position.netQty).toBe("100");
    expect(Number(r.position.currentValue)).toBeCloseTo(90000, 2);
    expect(r.transactions).toHaveLength(1);
    expect(r.history.length).toBeGreaterThanOrEqual(2);
    expect(typeof r.portfolioNetPnl).toBe("string");
  });

  it("404s for a security the caller has never traded", async () => {
    const cookie = await signup("sd2");
    // A security exists in the shared master but this user has no transaction in it.
    const sid = (await post("/api/securities", cookie, { symbol: "WIPRO", name: "Wipro", assetClass: "equity" })).json().security.id;
    const res = await get(`/api/securities/${sid}/detail`, cookie);
    expect(res.statusCode).toBe(404);
  });
});
