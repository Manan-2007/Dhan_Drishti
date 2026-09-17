import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import type { FxProvider, MarketDataProvider, SecurityLike, QuoteData } from "../src/market/types.js";

class FakeFx implements FxProvider {
  id = "fakefx";
  async getRate(from: string, to: string): Promise<string | null> {
    if (from === to) return "1";
    if (from === "USD" && to === "INR") return "83";
    return null;
  }
}

// Prices every security at a fixed number in its own currency (no network).
class FakeMarket implements MarketDataProvider {
  id = "fakemkt";
  constructor(private price: number) {}
  async getQuotes(securities: SecurityLike[]): Promise<QuoteData[]> {
    return securities.map((s) => ({ securityId: s.id, price: String(this.price), prevClose: null, currency: s.currency, asOf: "2024-06-01T00:00:00.000Z", provider: this.id }));
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
  app = buildApp(db, { fxProvider: new FakeFx(), marketProvider: new FakeMarket(150) });
  await app.ready();
});

async function usdSetup(cookie: string) {
  const pid = (await post("/api/portfolios", cookie, { name: "US" })).json().portfolio.id;
  const sid = (await post("/api/securities", cookie, { symbol: "AAPL", name: "Apple", assetClass: "equity", currency: "USD" })).json().security.id;
  await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-01-01", quantity: "10", price: "100", currency: "USD" });
  return { pid, sid };
}

describe("multi-currency & FX", () => {
  it("INR-only portfolio: base currency INR, FX complete, normal totals", async () => {
    const cookie = await signup("inr1");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-01-01", quantity: "10", price: "100" });

    const h = (await get("/api/holdings", cookie)).json();
    expect(h.baseCurrency).toBe("INR");
    expect(h.fxComplete).toBe(true);
    expect(h.summary.invested).toBe("1000");
  });

  it("flags a foreign-currency holding as unconvertible until a rate exists", async () => {
    const cookie = await signup("usd1");
    await usdSetup(cookie);
    const h = (await get("/api/holdings", cookie)).json();
    expect(h.baseCurrency).toBe("INR");
    expect(h.fxComplete).toBe(false);
    expect(h.unconvertibleCurrencies).toEqual(["USD"]);
    // USD holding excluded from the INR base total (never summed as if it were rupees).
    expect(h.summary.invested).toBe("0");
    expect(h.holdings[0].baseInvested).toBeNull();
  });

  it("converts to base currency after refreshing FX rates", async () => {
    const cookie = await signup("usd2");
    await usdSetup(cookie);
    const refresh = await post("/api/exchange-rates/refresh", cookie, {});
    expect(refresh.json()).toMatchObject({ base: "INR", requested: 1, updated: 1 });

    const h = (await get("/api/holdings", cookie)).json();
    expect(h.fxComplete).toBe(true);
    expect(h.summary.invested).toBe("83000"); // 10 * 100 USD * 83
    expect(h.holdings[0].baseInvested).toBe("83000");
    expect(h.allocation.byCurrency[0].key).toBe("USD");
  });

  it("accepts a manual rate and lists latest rates", async () => {
    const cookie = await signup("usd3");
    await usdSetup(cookie);
    const put = await app.inject({ method: "PUT", url: "/api/exchange-rates", headers: { cookie }, payload: { from: "USD", to: "INR", rate: "85" } });
    expect(put.statusCode).toBe(200);

    const rates = (await get("/api/exchange-rates", cookie)).json().rates;
    expect(rates.find((r: { baseCurrency: string }) => r.baseCurrency === "USD").rate).toBe("85");

    const h = (await get("/api/holdings", cookie)).json();
    expect(h.summary.invested).toBe("85000"); // uses the manual 85
  });

  it("decomposes a foreign holding's gain into asset vs currency return", async () => {
    const cookie = await signup("fxd1");
    const pid = (await post("/api/portfolios", cookie, { name: "US" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "AAPL", name: "Apple", assetClass: "equity", currency: "USD" })).json().security.id;
    // Buy at USD→INR 80 (FX-at-cost supplied); current FX will be 83, current price 150 USD.
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2023-05-01", quantity: "10", price: "100", currency: "USD", fxRateToBase: "80" });
    await post("/api/exchange-rates/refresh", cookie, {}); // USD→INR 83
    await post("/api/market-data/refresh", cookie, {}); // AAPL 150 USD

    const h = (await get("/api/holdings", cookie)).json();
    const row = h.holdings[0];
    expect(row.avgFxAtCost).toBe("80");
    expect(row.investedBaseAtCost).toBe("80000"); // 1000 USD × 80
    // asset: (1500−1000)×80 = 40000 ; currency: 1500×(83−80) = 4500
    expect(row.assetReturnBase).toBe("40000");
    expect(row.currencyReturnBase).toBe("4500");
    expect(h.fxImpact.assetReturn).toBe("40000");
    expect(h.fxImpact.currencyReturn).toBe("4500");
    expect(h.fxImpact.total).toBe("44500"); // = 1500×83 − 1000×80
    expect(h.fxImpact.decomposablePositions).toBe(1);
  });

  it("flags a foreign holding with no FX-at-cost as not decomposable", async () => {
    const cookie = await signup("fxd2");
    const pid = (await post("/api/portfolios", cookie, { name: "US" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "MSFT", name: "Microsoft", assetClass: "equity", currency: "USD" })).json().security.id;
    // No fxRateToBase supplied and no historical provider on the fake → FX-at-cost unknown.
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2023-05-01", quantity: "10", price: "100", currency: "USD" });
    await post("/api/exchange-rates/refresh", cookie, {});
    await post("/api/market-data/refresh", cookie, {});

    const h = (await get("/api/holdings", cookie)).json();
    expect(h.holdings[0].assetReturnBase).toBeNull();
    expect(h.fxImpact.decomposablePositions).toBe(0);
    expect(h.fxImpact.missingCostFxCurrencies).toEqual(["USD"]);
  });
});
