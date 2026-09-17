import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import type { MarketDataProvider, SecurityLike, QuoteData, BenchmarkProvider, BenchmarkBar, SecurityHistoryProvider } from "../src/market/types.js";

class FakeProvider implements MarketDataProvider {
  id = "fake";
  constructor(private price: number) {}
  async getQuotes(securities: SecurityLike[]): Promise<QuoteData[]> {
    return securities.map((s) => ({ securityId: s.id, price: String(this.price), prevClose: null, currency: s.currency, asOf: "2024-06-01T00:00:00.000Z", provider: this.id }));
  }
}

// A deterministic index that was 100 on 2023-05-01 and doubled to 200 by 2024-06-01.
class FakeBenchmark implements BenchmarkProvider {
  id = "fakebench";
  async getHistory(): Promise<BenchmarkBar[]> {
    return [
      { date: "2023-05-01", close: 100 },
      { date: "2024-06-01", close: 200 },
    ];
  }
}

// Deterministic per-security history: 100 on 2023-01-01, 150 on 2023-07-01. MFs have none.
class FakeHistory implements SecurityHistoryProvider {
  id = "fakehist";
  async getHistory(security: SecurityLike): Promise<BenchmarkBar[]> {
    if (security.assetClass === "mf") return [];
    const today = new Date().toISOString().slice(0, 10);
    return [
      { date: "2023-01-01", close: 100 },
      { date: "2023-07-01", close: 150 },
      { date: today, close: 150 },
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
  app = buildApp(db, { marketProvider: new FakeProvider(150), benchmarkProvider: new FakeBenchmark(), historyProvider: new FakeHistory() });
  await app.ready();
});

describe("GET /api/performance/summary", () => {
  it("rolls realised P&L up by FY and segment", async () => {
    const cookie = await signup("perf1");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2023-05-01", quantity: "10", price: "100" });
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "sell", tradeDate: "2023-06-01", quantity: "10", price: "150" });
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "dividend", tradeDate: "2023-09-01", grossAmount: "200" });

    const res = await get("/api/performance/summary", cookie);
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.summary.realisedPnl).toBe("500");
    expect(p.summary.dividends).toBe("200");
    const fy = p.byFY.find((x: { key: string }) => x.key === "FY 23-24");
    expect(fy.realised).toBe("500");
    expect(fy.dividends).toBe("200");
    // Fully closed → XIRR available.
    expect(p.xirrAvailable).toBe(true);
    expect(p.xirr).toBeGreaterThan(0);
  });

  it("marks XIRR unavailable while an open position has no price", async () => {
    const cookie = await signup("perf2");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "INFY", name: "Infy", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2023-05-01", quantity: "10", price: "100" });

    const before = await get("/api/performance/summary", cookie);
    expect(before.json().xirrAvailable).toBe(false);
    expect(before.json().xirr).toBeNull();

    // After pricing the open position, XIRR becomes available.
    await post("/api/market-data/refresh", cookie, {});
    const after = await get("/api/performance/summary", cookie);
    expect(after.json().xirrAvailable).toBe(true);
    expect(after.json().xirr).not.toBeNull();
  });
});

describe("GET /api/performance/benchmark", () => {
  it("lists the available benchmarks", async () => {
    const cookie = await signup("bench0");
    const res = await get("/api/performance/benchmarks", cookie);
    expect(res.statusCode).toBe(200);
    const ids = res.json().benchmarks.map((b: { id: string }) => b.id);
    expect(ids).toContain("nifty50");
  });

  it("mirrors the same cashflows into the index and compares returns", async () => {
    const cookie = await signup("bench1");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security.id;
    // ₹1000 invested when the index was 100. Position priced at 150 → portfolio worth ₹1500;
    // the same ₹1000 in the index (100 → 200) would be worth ₹2000.
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2023-05-01", quantity: "10", price: "100" });
    await post("/api/market-data/refresh", cookie, {});

    const res = await get("/api/performance/benchmark?benchmark=nifty50", cookie);
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.available).toBe(true);
    expect(b.benchmarkId).toBe("nifty50");
    expect(Number(b.portfolio.currentValue)).toBe(1500);
    expect(Number(b.index.currentValue)).toBe(2000); // 10 units × 200
    expect(Number(b.index.investedNet)).toBe(1000);
    expect(b.index.latestClose).toBe(200);
    expect(b.index.matchedFlows).toBe(1);
    expect(b.index.unmatchedFlows).toBe(0);
    // Both returns computable; the index outperformed here.
    expect(b.portfolio.xirr).not.toBeNull();
    expect(b.index.xirr).not.toBeNull();
    expect(b.index.xirr).toBeGreaterThan(b.portfolio.xirr);
  });

  it("is unavailable (no portfolio XIRR) while an open position is unpriced", async () => {
    const cookie = await signup("bench2");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "INFY", name: "Infy", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2023-05-01", quantity: "10", price: "100" });

    const res = await get("/api/performance/benchmark?benchmark=nifty50", cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().available).toBe(false);
    expect(res.json().reason).toMatch(/prices/i);
  });

  it("rejects an unknown benchmark id", async () => {
    const cookie = await signup("bench3");
    const res = await get("/api/performance/benchmark?benchmark=nope", cookie);
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/performance/twr", () => {
  it("chains sub-period price growth into a time-weighted return", async () => {
    const cookie = await signup("twr1");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security.id;
    // Buy 10 @100 (2023-01-01); buy 10 @150 (2023-07-01, price then 150); now priced at 150.
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2023-01-01", quantity: "10", price: "100" });
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2023-07-01", quantity: "10", price: "150" });
    await post("/api/market-data/refresh", cookie, {}); // current value = 20 × 150 = 3000

    const res = await get("/api/performance/twr", cookie);
    expect(res.statusCode).toBe(200);
    const t = res.json();
    // period1 1500/1000 = 1.5 ; period2 3000/3000 = 1.0 → TWR 50%
    expect(t.available).toBe(true);
    expect(t.subPeriods).toBe(2);
    expect(t.twr).toBeCloseTo(0.5, 6);
  });

  it("is unavailable for a holding with no price history (e.g. a mutual fund)", async () => {
    const cookie = await signup("twr2");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "PPFAS", name: "Parag Flexi", assetClass: "mf" })).json().security.id;
    // Two buys → an intermediate valuation is needed, which requires price history the MF lacks.
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2023-01-01", quantity: "10", price: "100" });
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2023-07-01", quantity: "10", price: "120" });
    await post("/api/market-data/refresh", cookie, {});

    const res = await get("/api/performance/twr", cookie);
    expect(res.json().available).toBe(false);
    expect(res.json().missingHistory).toContain("PPFAS");
  });

  it("is unavailable for a multi-currency scope", async () => {
    const cookie = await signup("twr3");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const s1 = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security.id;
    const s2 = (await post("/api/securities", cookie, { symbol: "AAPL", name: "Apple", assetClass: "equity", currency: "USD" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: s1, type: "buy", tradeDate: "2023-01-01", quantity: "10", price: "100" });
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: s2, type: "buy", tradeDate: "2023-01-01", quantity: "5", price: "100", currency: "USD" });

    const res = await get("/api/performance/twr", cookie);
    expect(res.json().available).toBe(false);
    expect(res.json().reason).toMatch(/single currency/i);
  });
});
