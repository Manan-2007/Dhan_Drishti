import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import type { MarketDataProvider, SecurityLike, QuoteData } from "../src/market/types.js";

// Deterministic fake provider — never touches the network.
class FakeProvider implements MarketDataProvider {
  id = "fake";
  constructor(private priceBySymbol: Record<string, number>) {}
  async getQuotes(securities: SecurityLike[]): Promise<QuoteData[]> {
    return securities
      .filter((s) => this.priceBySymbol[s.symbol] != null)
      .map((s) => ({
        securityId: s.id,
        price: String(this.priceBySymbol[s.symbol]),
        prevClose: String(this.priceBySymbol[s.symbol]! - 10),
        currency: s.currency,
        asOf: "2024-04-01T00:00:00.000Z",
        provider: this.id,
      }));
  }
}

let app: FastifyInstance;

async function signup(username: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "supersecret1" } });
  const raw = res.headers["set-cookie"];
  return (Array.isArray(raw) ? raw[0]! : (raw as string)).split(";")[0]!;
}
const post = (url: string, cookie: string, payload?: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });

async function build(prices: Record<string, number>) {
  const { db } = await createDb(":memory:");
  app = buildApp(db, { marketProvider: new FakeProvider(prices) });
  await app.ready();
}

describe("market data refresh", () => {
  it("returns zero when there are no held securities", async () => {
    await build({});
    const cookie = await signup("mkt0");
    const res = await post("/api/market-data/refresh", cookie, {});
    expect(res.json()).toMatchObject({ requested: 0, updated: 0 });
  });

  it("writes quotes so holdings gain current value & unrealised P&L", async () => {
    await build({ INFY: 150 });
    const cookie = await signup("mkt1");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "INFY", name: "Infosys", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-01-01", quantity: "10", price: "100" });

    // Before refresh: no price.
    let holdings = (await get("/api/holdings", cookie)).json();
    expect(holdings.holdings[0].currentValue).toBeNull();

    const refresh = await post("/api/market-data/refresh", cookie, {});
    expect(refresh.json()).toMatchObject({ requested: 1, updated: 1, failed: 0 });

    // After refresh: valued.
    holdings = (await get("/api/holdings", cookie)).json();
    expect(holdings.holdings[0].currentValue).toBe("1500");
    expect(holdings.holdings[0].unrealisedPnl).toBe("500");
    expect(holdings.holdings[0].todayChange).toBe("100"); // 10 * (150 - 140)
    expect(holdings.summary.allPriced).toBe(true);

    const status = (await get("/api/market-data/status", cookie)).json();
    expect(status.lastUpdated).toBe("2024-04-01T00:00:00.000Z");
  });

  it("counts securities the provider couldn't price as failed", async () => {
    await build({}); // provider returns nothing
    const cookie = await signup("mkt2");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "UNKNOWN", name: "X", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-01-01", quantity: "1", price: "10" });
    const res = await post("/api/market-data/refresh", cookie, {});
    expect(res.json()).toMatchObject({ requested: 1, updated: 0, failed: 1 });
  });
});
