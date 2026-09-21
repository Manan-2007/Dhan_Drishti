import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb, type DB } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import { refreshAllHeldQuotes, snapshotAllUsers } from "../src/jobs/scheduler.js";
import type { MarketDataProvider, SecurityLike, QuoteData } from "../src/market/types.js";

class FakeProvider implements MarketDataProvider {
  id = "fake";
  constructor(private p: Record<string, number>) {}
  async getQuotes(secs: SecurityLike[]): Promise<QuoteData[]> {
    return secs
      .filter((s) => this.p[s.symbol] != null)
      .map((s) => ({ securityId: s.id, price: String(this.p[s.symbol]), prevClose: null, currency: s.currency, asOf: new Date().toISOString(), provider: this.id }));
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
const mkPortfolio = async (cookie: string) => (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;

beforeEach(async () => {
  const r = await createDb(":memory:");
  db = r.db;
  app = buildApp(db, { marketProvider: new FakeProvider({ INFY: 1600, TCS: 4000 }) });
  await app.ready();
});

describe("net-worth snapshots", () => {
  it("records a snapshot on holdings load that the net-worth series returns", async () => {
    const cookie = await signup("sn1");
    const pid = await mkPortfolio(cookie);
    // Holdings snapshot: INFY 10 @1500 with LTP 1600 → priced value 16,000.
    const csv = "Instrument,Qty.,Avg. cost,LTP\nINFY,10,1500,1600";
    await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "holdings", filename: "h.csv", content: csv });
    await get("/api/holdings", cookie); // lazily writes today's snapshot

    const nw = (await get("/api/performance/networth?range=max", cookie)).json();
    expect(nw.series.length).toBe(1);
    expect(Number(nw.series[0].netWorth)).toBeCloseTo(16000, 2);
    expect(nw.series[0].date).toBe(new Date().toISOString().slice(0, 10));
  });

  it("the scheduler snapshots the aggregate and each portfolio for every user", async () => {
    const cookie = await signup("sn2");
    const pid = await mkPortfolio(cookie);
    await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "holdings", filename: "h.csv", content: "Instrument,Qty.,Avg. cost,LTP\nTCS,5,3000,4000" });

    await snapshotAllUsers(db); // the daily cron pass

    const agg = (await get("/api/performance/networth", cookie)).json(); // portfolioId omitted → aggregate
    const one = (await get(`/api/performance/networth?portfolioId=${pid}`, cookie)).json();
    expect(agg.series.length).toBe(1);
    expect(one.series.length).toBe(1);
    expect(Number(agg.series[0].netWorth)).toBeCloseTo(20000, 2); // 5 × 4000
  });

  it("refreshes prices for all held securities in one background pass", async () => {
    const cookie = await signup("sn3");
    const pid = await mkPortfolio(cookie);
    // A tradebook (no seeded quote) → unpriced until a refresh runs.
    await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "zerodha", filename: "t.csv", content: "symbol,trade_type,quantity,price,trade_date\nINFY,buy,10,1500,2025-04-01" });
    let h = (await get("/api/holdings", cookie)).json();
    expect(h.summary.pricedPositions).toBe(0);

    const res = await refreshAllHeldQuotes(db, new FakeProvider({ INFY: 1600 }));
    expect(res.updated).toBe(1);

    h = (await get("/api/holdings", cookie)).json();
    expect(h.summary.pricedPositions).toBe(1);
    expect(Number(h.summary.currentValue)).toBeCloseTo(16000, 2);
  });
});
