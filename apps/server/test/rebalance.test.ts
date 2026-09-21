import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import type { MarketDataProvider, QuoteData, SecurityLike } from "../src/market/types.js";

// Deterministic prices so allocation weights are exact and testable.
class FixedProvider implements MarketDataProvider {
  id = "fixed";
  constructor(private prices: Record<string, string>) {}
  async getQuotes(securities: SecurityLike[]): Promise<QuoteData[]> {
    return securities
      .filter((s) => this.prices[s.symbol])
      .map((s) => ({ securityId: s.id, price: this.prices[s.symbol]!, currency: "INR", asOf: new Date().toISOString(), provider: this.id }));
  }
}

let app: FastifyInstance;
async function signup(u: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: u, password: "supersecret1" } });
  const raw = res.headers["set-cookie"];
  return (Array.isArray(raw) ? raw[0]! : (raw as string)).split(";")[0]!;
}
const post = (url: string, cookie: string, payload?: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload });
const put = (url: string, cookie: string, payload?: unknown) => app.inject({ method: "PUT", url, headers: { cookie }, payload });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });

/** Set up a portfolio worth ₹100k: 70k equity (TCS) + 30k gold ETF, both priced. */
async function seedPortfolio(cookie: string) {
  const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
  const tcs = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security.id;
  const gold = (await post("/api/securities", cookie, { symbol: "GOLDBEES", name: "Gold ETF", assetClass: "etf" })).json().security.id;
  await post("/api/transactions", cookie, { portfolioId: pid, securityId: tcs, type: "buy", tradeDate: "2024-01-01", quantity: "100", price: "700" });
  await post("/api/transactions", cookie, { portfolioId: pid, securityId: gold, type: "buy", tradeDate: "2024-01-01", quantity: "100", price: "300" });
  await post("/api/market-data/refresh", cookie, {}); // fetch quotes → TCS 700, GOLDBEES 300 (unchanged)
  return { pid, tcs, gold };
}

beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db, { marketProvider: new FixedProvider({ TCS: "700", GOLDBEES: "300" }) });
  await app.ready();
});

describe("rebalance / target allocation", () => {
  it("reports no drift until targets are set", async () => {
    const cookie = await signup("rb1");
    await seedPortfolio(cookie);
    const r = (await get("/api/rebalance?dimension=asset_class", cookie)).json();
    expect(r.hasTargets).toBe(false);
    expect(Number(r.totalValue)).toBeCloseTo(100000, 2);
    const equity = r.rows.find((x: { key: string }) => x.key === "equity");
    expect(Number(equity.currentWeight)).toBeCloseTo(0.7, 6);
    expect(equity.targetWeight).toBeNull();
    expect(equity.driftValue).toBeNull();
  });

  it("computes weight and rupee drift against saved targets", async () => {
    const cookie = await signup("rb2");
    await seedPortfolio(cookie);
    // Target 60% equity / 40% etf; actual is 70/30.
    const r = (await put("/api/rebalance", cookie, { dimension: "asset_class", targets: [{ key: "equity", weight: "0.6" }, { key: "etf", weight: "0.4" }] })).json();
    expect(r.hasTargets).toBe(true);
    const equity = r.rows.find((x: { key: string }) => x.key === "equity");
    const etf = r.rows.find((x: { key: string }) => x.key === "etf");
    expect(Number(equity.driftWeight)).toBeCloseTo(0.1, 6); // 70% − 60% = +10% over
    expect(Number(equity.driftValue)).toBeCloseTo(10000, 2); // trim ₹10k
    expect(equity.action).toBe("trim");
    expect(Number(etf.driftValue)).toBeCloseTo(-10000, 2); // add ₹10k
    expect(etf.action).toBe("add");
  });

  it("persists targets and rejects weights over 100%", async () => {
    const cookie = await signup("rb3");
    await seedPortfolio(cookie);
    await put("/api/rebalance", cookie, { dimension: "asset_class", targets: [{ key: "equity", weight: "0.5" }] });
    const reload = (await get("/api/rebalance?dimension=asset_class", cookie)).json();
    expect(reload.rows.find((x: { key: string }) => x.key === "equity").targetWeight).toBe("0.5");

    const bad = await put("/api/rebalance", cookie, { dimension: "asset_class", targets: [{ key: "equity", weight: "0.7" }, { key: "etf", weight: "0.5" }] });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("targets_over_100");
  });
});
