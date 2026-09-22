import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createDb, type DB } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import { quotes } from "../src/db/schema.js";
import type { MarketDataProvider, QuoteData, SecurityLike } from "../src/market/types.js";

// Returns a fresh, higher price each refresh, with a strictly-later asOf, so "the latest quote" is
// unambiguous across refreshes.
class BumpingProvider implements MarketDataProvider {
  id = "bump";
  private n = 0;
  async getQuotes(securities: SecurityLike[]): Promise<QuoteData[]> {
    this.n += 1;
    const asOf = new Date(Date.UTC(2025, 0, 1) + this.n * 86_400_000).toISOString();
    return securities.map((s) => ({ securityId: s.id, price: String(1000 + this.n * 100), currency: "INR", asOf, provider: this.id }));
  }
}

let app: FastifyInstance;
let db: DB;
async function signup(u: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: u, password: "supersecret1" } });
  const raw = res.headers["set-cookie"];
  return (Array.isArray(raw) ? raw[0]! : (raw as string)).split(";")[0]!;
}
const post = (url: string, cookie: string, payload?: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });

beforeEach(async () => {
  ({ db } = await createDb(":memory:"));
  app = buildApp(db, { marketProvider: new BumpingProvider() });
  await app.ready();
});

describe("quotes pruning + latest price", () => {
  it("keeps only the newest quote per security across refreshes, and values at the latest", async () => {
    const cookie = await signup("qtest1");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-01-01", quantity: "10", price: "500" });

    await post("/api/market-data/refresh", cookie, {}); // price 1100
    await post("/api/market-data/refresh", cookie, {}); // price 1200
    await post("/api/market-data/refresh", cookie, {}); // price 1300

    // Three refreshes, but only the latest quote survives.
    const rows = await db.select().from(quotes).where(eq(quotes.securityId, sid)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.price).toBe("1300");

    const h = (await get("/api/holdings", cookie)).json();
    expect(h.summary.pricedPositions).toBe(1);
    expect(Number(h.summary.currentValue)).toBeCloseTo(13000, 2); // 10 × 1300 (latest)

    const status = (await get("/api/market-data/status", cookie)).json();
    expect(status.lastUpdated).toBe(new Date(Date.UTC(2025, 0, 1) + 3 * 86_400_000).toISOString());
  });

  it("reflects a new transaction immediately (cache invalidated on write)", async () => {
    const cookie = await signup("qtest2");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "INFY", name: "Infosys", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-01-01", quantity: "10", price: "100" });

    // Prime the cache.
    let h = (await get("/api/holdings", cookie)).json();
    expect(h.holdings.find((x: { security: { symbol: string } }) => x.security.symbol === "INFY").netQty).toBe("10");

    // A new buy must show up on the very next read — no stale cache.
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-02-01", quantity: "5", price: "110" });
    h = (await get("/api/holdings", cookie)).json();
    expect(h.holdings.find((x: { security: { symbol: string } }) => x.security.symbol === "INFY").netQty).toBe("15");
  });
});
