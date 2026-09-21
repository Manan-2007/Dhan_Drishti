import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import type { MarketDataProvider, QuoteData, SecurityLike } from "../src/market/types.js";

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
const del = (url: string, cookie: string) => app.inject({ method: "DELETE", url, headers: { cookie } });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });

beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db, { marketProvider: new FixedProvider({ TCS: "700" }) });
  await app.ready();
});

describe("manual (non-market) assets", () => {
  it("folds a manual asset into net worth and allocation", async () => {
    const cookie = await signup("ma1");
    await post("/api/manual-assets", cookie, { name: "SBI Fixed Deposit", assetClass: "fd", currentValue: "500000" });

    const h = (await get("/api/holdings", cookie)).json();
    expect(h.summary.manualAssets).toBe("500000");
    expect(h.summary.netWorth).toBe("500000"); // no securities, no cash → net worth is the FD
    const fd = h.allocation.byAssetClass.find((x: { key: string }) => x.key === "fd");
    expect(fd).toBeTruthy();
    expect(Number(fd.weight)).toBeCloseTo(1, 6);
    const india = h.allocation.byRegion.find((x: { key: string }) => x.key === "India");
    expect(Number(india.weight)).toBeCloseTo(1, 6);
    expect(h.manualAssets).toHaveLength(1);
    expect(h.manualAssets[0].name).toBe("SBI Fixed Deposit");
  });

  it("adds manual value on top of priced holdings in net worth and splits allocation", async () => {
    const cookie = await signup("ma2");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const tcs = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: tcs, type: "buy", tradeDate: "2024-01-01", quantity: "100", price: "700" });
    await post("/api/market-data/refresh", cookie, {}); // TCS → ₹70,000
    await post("/api/manual-assets", cookie, { name: "Apartment", assetClass: "real_estate", currentValue: "30000" });

    const h = (await get("/api/holdings", cookie)).json();
    expect(Number(h.summary.currentValue)).toBeCloseTo(70000, 2);
    expect(h.summary.manualAssets).toBe("30000");
    expect(Number(h.summary.netWorth)).toBeCloseTo(100000, 2); // 70k equity + 30k real estate
    const re = h.allocation.byAssetClass.find((x: { key: string }) => x.key === "real_estate");
    expect(Number(re.weight)).toBeCloseTo(0.3, 6);
    const eq = h.allocation.byAssetClass.find((x: { key: string }) => x.key === "equity");
    expect(Number(eq.weight)).toBeCloseTo(0.7, 6);
  });

  it("reports a gain when a cost is provided, and stamps valueAsOf on a value change", async () => {
    const cookie = await signup("ma3");
    const created = (await post("/api/manual-assets", cookie, { name: "Gold", assetClass: "gold", currentValue: "120000", cost: "100000" })).json();
    const id = created.asset.id;

    const list = (await get("/api/manual-assets", cookie)).json();
    expect(list.total).toBe("120000");
    expect(list.totalCost).toBe("100000");
    expect(list.items[0].gain).toBe("20000");

    const upd = (await put(`/api/manual-assets/${id}`, cookie, { currentValue: "130000" })).json();
    expect(upd.asset.currentValue).toBe("130000");
    expect(upd.asset.valueAsOf).toBe(new Date().toISOString().slice(0, 10));

    await del(`/api/manual-assets/${id}`, cookie);
    expect((await get("/api/manual-assets", cookie)).json().count).toBe(0);
  });

  it("scopes assets to their portfolio", async () => {
    const cookie = await signup("ma4");
    const a = (await post("/api/portfolios", cookie, { name: "A" })).json().portfolio.id;
    const b = (await post("/api/portfolios", cookie, { name: "B" })).json().portfolio.id;
    await post("/api/manual-assets", cookie, { name: "PPF", assetClass: "ppf", currentValue: "200000", portfolioId: a });

    expect((await get(`/api/manual-assets?portfolioId=${a}`, cookie)).json().total).toBe("200000");
    expect((await get(`/api/manual-assets?portfolioId=${b}`, cookie)).json().total).toBe("0");
    expect((await get("/api/manual-assets", cookie)).json().total).toBe("200000"); // aggregate includes it
  });
});
