import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import type { MarketDataProvider, SecurityLike, QuoteData, BenchmarkProvider, BenchmarkBar, SecurityHistoryProvider } from "../src/market/types.js";

/**
 * End-to-end harness (Phase 16): the whole pipeline as one scripted journey —
 * signup → import a real broker CSV fixture → derived holdings/dashboard → analytics —
 * plus per-broker fixtures, idempotent re-import, per-user isolation, and data export.
 * Deterministic (fake providers, no network) so it asserts exact golden figures.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "fixtures", name), "utf8");
const ZERODHA = fixture("zerodha-tradebook.csv");
const DHAN = fixture("dhan-tradebook.csv");

// Every security marks at ₹2000; the same flat price feeds live quotes and history so the
// journey's numbers are fully determined.
class FakeMarket implements MarketDataProvider {
  id = "fake";
  async getQuotes(securities: SecurityLike[]): Promise<QuoteData[]> {
    return securities.map((s) => ({ securityId: s.id, price: "2000", prevClose: "1950", currency: s.currency, asOf: "2024-06-01T00:00:00.000Z", provider: this.id }));
  }
}
class FakeHistory implements SecurityHistoryProvider {
  id = "fakehist";
  async getHistory(): Promise<BenchmarkBar[]> {
    return [{ date: "2022-01-01", close: 2000 }, { date: new Date().toISOString().slice(0, 10), close: 2000 }];
  }
}
class FakeBenchmark implements BenchmarkProvider {
  id = "fakebench";
  async getHistory(): Promise<BenchmarkBar[]> {
    return [{ date: "2022-01-01", close: 100 }, { date: new Date().toISOString().slice(0, 10), close: 150 }];
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
  app = buildApp(db, { marketProvider: new FakeMarket(), historyProvider: new FakeHistory(), benchmarkProvider: new FakeBenchmark() });
  await app.ready();
});

describe("E2E — signup → import → dashboard → analytics", () => {
  it("runs the full journey with golden figures", async () => {
    // 1. Sign up + create a portfolio.
    const cookie = await signup("journey");
    const pid = (await post("/api/portfolios", cookie, { name: "Zerodha", kind: "broker" })).json().portfolio.id;

    // 2. Preview the Zerodha import (nothing written yet).
    const preview = (await post("/api/imports/check", cookie, { portfolioId: pid, broker: "zerodha", filename: "zerodha.csv", content: ZERODHA })).json();
    expect(preview).toMatchObject({ rowsTotal: 4, valid: 4, invalid: 0, duplicates: 0, toImport: 4, newSecurities: 2 });
    expect((await get("/api/transactions", cookie)).json().total).toBe(0); // preview persisted nothing

    // 3. Commit → 4 transactions; re-commit is idempotent.
    expect((await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "zerodha", filename: "zerodha.csv", content: ZERODHA })).json().imported).toBe(4);
    expect((await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "zerodha", filename: "zerodha.csv", content: ZERODHA })).json().imported).toBe(0);
    expect((await get("/api/transactions", cookie)).json().total).toBe(4);

    // 4. Record a dividend the way a user would after a payout.
    const infy = (await get("/api/holdings", cookie)).json().holdings.find((h: { security: { symbol: string } }) => h.security.symbol === "INFY");
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: infy.security.id, type: "dividend", tradeDate: "2023-03-15", grossAmount: "500" });

    // 5. Dashboard/holdings BEFORE prices: invested & realised are known; current value is honestly unknown.
    let h = (await get("/api/holdings", cookie)).json();
    expect(h.summary.invested).toBe("35600"); // INFY 18600 + TCS 17000
    expect(h.summary.realisedPnl).toBe("2000"); // 8 × (1800 − 1550)
    expect(h.summary.openPositions).toBe(2);
    expect(h.summary.allPriced).toBe(false);

    // 6. Refresh prices, then the full dashboard is derived.
    await post("/api/market-data/refresh", cookie, {});
    h = (await get("/api/holdings", cookie)).json();
    expect(h.summary.allPriced).toBe(true);
    expect(h.summary.currentValue).toBe("34000"); // 12×2000 + 5×2000
    expect(h.summary.unrealisedPnl).toBe("-1600"); // 34000 − 35600
    expect(h.summary.dividends).toBe("500");
    expect(h.summary.netPnl).toBe("900"); // -1600 + 2000 + 500
    const infyRow = h.holdings.find((r: { security: { symbol: string } }) => r.security.symbol === "INFY");
    expect(infyRow.netQty).toBe("12");
    expect(infyRow.avgCost).toBe("1550");
    // Allocation weights sum to 1 (all equity).
    const wsum = h.allocation.byAssetClass.reduce((a: number, s: { weight: string }) => a + Number(s.weight), 0);
    expect(wsum).toBeCloseTo(1, 6);

    // 7. Analytics — performance, dividends, benchmark, TWR.
    const perf = (await get("/api/performance/summary", cookie)).json();
    expect(perf.summary.realisedPnl).toBe("2000");
    expect(perf.byFY.find((f: { key: string }) => f.key === "FY 22-23").realised).toBe("2000");
    expect(perf.xirrAvailable).toBe(true);
    expect(typeof perf.xirr).toBe("number");

    const div = (await get("/api/dividends", cookie)).json();
    expect(div.total).toBe("500");
    expect(div.count).toBe(1);

    const bench = (await get("/api/performance/benchmark?benchmark=nifty50", cookie)).json();
    expect(bench.available).toBe(true);
    expect(bench.index.currentValue).toBeTruthy();

    const twr = (await get("/api/performance/twr", cookie)).json();
    expect(twr.available).toBe(true);
    expect(twr.subPeriods).toBe(4);
    expect(Number.isFinite(twr.twr)).toBe(true);
  });

  it("consolidates a second broker (Dhan) across portfolios", async () => {
    const cookie = await signup("multi");
    const p1 = (await post("/api/portfolios", cookie, { name: "Zerodha" })).json().portfolio.id;
    const p2 = (await post("/api/portfolios", cookie, { name: "Dhan" })).json().portfolio.id;
    await post("/api/imports/commit", cookie, { portfolioId: p1, broker: "zerodha", filename: "z.csv", content: ZERODHA });
    expect((await post("/api/imports/commit", cookie, { portfolioId: p2, broker: "dhan", filename: "d.csv", content: DHAN })).json().imported).toBe(3);

    // All-portfolios holdings combine both brokers.
    const all = (await get("/api/holdings", cookie)).json().holdings;
    const symbols = all.map((r: { security: { symbol: string } }) => r.security.symbol);
    expect(symbols).toEqual(expect.arrayContaining(["INFY", "TCS", "J & K BANK"]));
    const jk = all.find((r: { security: { symbol: string } }) => r.security.symbol === "J & K BANK");
    expect(jk.netQty).toBe("60"); // 100 − 40

    // Scoped to one portfolio, only its holdings show.
    const scoped = (await get(`/api/holdings?portfolioId=${p2}`, cookie)).json().holdings;
    expect(scoped.every((r: { security: { symbol: string } }) => r.security.symbol !== "INFY")).toBe(true);
  });

  it("keeps each user's data fully isolated", async () => {
    const a = await signup("owner");
    const pid = (await post("/api/portfolios", a, { name: "Mine" })).json().portfolio.id;
    await post("/api/imports/commit", a, { portfolioId: pid, broker: "zerodha", filename: "z.csv", content: ZERODHA });

    const b = await signup("stranger");
    expect((await get("/api/portfolios", b)).json().portfolios).toHaveLength(0);
    expect((await get("/api/transactions", b)).json().total).toBe(0);
    expect((await get("/api/holdings", b)).json().holdings).toHaveLength(0);
    // A stranger cannot read another user's portfolio (existence not revealed).
    expect((await get(`/api/holdings?portfolioId=${pid}`, b)).statusCode).toBe(404);
  });

  it("exports the user's own data as a portable snapshot", async () => {
    const cookie = await signup("exporter");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "zerodha", filename: "z.csv", content: ZERODHA });

    const res = await get("/api/account/export", cookie);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    const dump = res.json();
    expect(dump.schemaVersion).toBe(1);
    expect(dump.portfolios).toHaveLength(1);
    expect(dump.transactions).toHaveLength(4);
    expect(dump.securities.map((s: { symbol: string }) => s.symbol)).toEqual(expect.arrayContaining(["INFY", "TCS"]));
  });
});
