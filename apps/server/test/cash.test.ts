import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import type { MarketDataProvider, SecurityLike, QuoteData, SecurityHistoryProvider, BenchmarkBar } from "../src/market/types.js";

class FakeMarket implements MarketDataProvider {
  id = "fake";
  constructor(private price: number) {}
  async getQuotes(securities: SecurityLike[]): Promise<QuoteData[]> {
    return securities.map((s) => ({ securityId: s.id, price: String(this.price), prevClose: null, currency: s.currency, asOf: "2024-06-01T00:00:00.000Z", provider: this.id }));
  }
}
class FakeHistory implements SecurityHistoryProvider {
  id = "fakehist";
  async getHistory(): Promise<BenchmarkBar[]> {
    return [{ date: "2024-01-01", close: 6000 }, { date: new Date().toISOString().slice(0, 10), close: 6000 }];
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
  app = buildApp(db, { marketProvider: new FakeMarket(6000), historyProvider: new FakeHistory() });
  await app.ready();
});

async function fundedPortfolio(cookie: string) {
  const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
  const sid = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security.id;
  await post("/api/transactions", cookie, { portfolioId: pid, type: "deposit", tradeDate: "2024-01-01", grossAmount: "100000" });
  await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-02-01", quantity: "10", price: "5000" });
  await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "dividend", tradeDate: "2024-06-01", grossAmount: "800" });
  return { pid, sid };
}

describe("cash balance & net worth", () => {
  it("derives cash and net worth from the ledger, and folds cash into allocation", async () => {
    const cookie = await signup("cash1");
    await fundedPortfolio(cookie);
    await post("/api/market-data/refresh", cookie, {});

    const h = (await get("/api/holdings", cookie)).json();
    expect(h.cashTracked).toBe(true);
    expect(h.summary.cash).toBe("50800"); // 100000 − 50000 buy + 800 dividend
    expect(h.summary.currentValue).toBe("60000"); // 10 × 6000
    expect(h.summary.netWorth).toBe("110800"); // holdings + cash
    const cashSlice = h.allocation.byAssetClass.find((s: { key: string }) => s.key === "cash");
    expect(cashSlice.value).toBe("50800");
  });

  it("shows no cash tracking when the ledger records no deposits/withdrawals", async () => {
    const cookie = await signup("cash2");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-02-01", quantity: "10", price: "5000" });

    const h = (await get("/api/holdings", cookie)).json();
    expect(h.cashTracked).toBe(false);
    expect(h.summary.cash).toBe("0");
  });

  it("computes a cash-inclusive TWR that retains dividends", async () => {
    const cookie = await signup("cash3");
    await fundedPortfolio(cookie);
    await post("/api/market-data/refresh", cookie, {});

    const twr = (await get("/api/performance/twr", cookie)).json();
    expect(twr.available).toBe(true);
    expect(twr.mode).toBe("cash-inclusive");
    expect(twr.subPeriods).toBe(1);
    // Deposit 100000 → net worth 110800 (holdings 60000 + retained cash 50800) → +10.8%.
    expect(twr.twr).toBeCloseTo(0.108, 6);
  });
});
