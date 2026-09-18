import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
async function signup(u: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: u, password: "supersecret1" } });
  const raw = res.headers["set-cookie"];
  return (Array.isArray(raw) ? raw[0]! : (raw as string)).split(";")[0]!;
}
const post = (url: string, cookie: string, payload?: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
const mkPortfolio = async (cookie: string) => (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
const find = (rows: { security: { symbol: string } }[], s: string) => rows.find((h) => h.security.symbol === s);

beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db);
  await app.ready();
});

describe("holdings snapshot import", () => {
  // Zerodha "Holdings" export: plain numbers, ticker instruments.
  const ZERODHA = ["Instrument,Qty.,Avg. cost,LTP,Invested,Cur. val", "ALIVUS,142,1063.21,1380.05,150975.55,195967.1", "TCS,10,3400,4000,34000,40000"].join("\n");
  // Dhan "Portfolio" export: quoted names + Indian comma grouping.
  const DHAN = ['"Name","Quantity","Avg Price","Last Traded","Investment"', '"APL Apollo Tubes",100,"1,643.34","2,139.90","1,64,333.90"'].join("\n");

  it("imports Zerodha holdings as buys and seeds current value from LTP", async () => {
    const cookie = await signup("hs1");
    const pid = await mkPortfolio(cookie);
    const preview = (await post("/api/imports/check", cookie, { portfolioId: pid, broker: "holdings", filename: "z.csv", content: ZERODHA })).json();
    expect(preview.toImport).toBe(2);
    await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "holdings", filename: "z.csv", content: ZERODHA });

    const h = (await get("/api/holdings", cookie)).json();
    const alivus = find(h.holdings, "ALIVUS")!;
    expect(alivus.netQty).toBe("142");
    expect(alivus.avgCost).toBe("1063.21");
    // Current value comes from the seeded LTP quote — no live refresh needed.
    expect(Number(alivus.currentValue)).toBeCloseTo(142 * 1380.05, 2);
    expect(h.summary.allPriced).toBe(true);
  });

  it("handles Indian comma-grouped numbers and name-based instruments (Dhan)", async () => {
    const cookie = await signup("hs2");
    const pid = await mkPortfolio(cookie);
    await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "holdings", filename: "d.csv", content: DHAN });

    const h = (await get("/api/holdings", cookie)).json();
    const apl = find(h.holdings, "APL APOLLO TUBES")!;
    expect(apl.netQty).toBe("100");
    expect(apl.invested).toBe("164334"); // 100 × 1,643.34
    expect(Number(apl.currentValue)).toBeCloseTo(213990, 2); // 100 × 2,139.90 from LTP
  });

  it("re-importing the same snapshot is idempotent", async () => {
    const cookie = await signup("hs3");
    const pid = await mkPortfolio(cookie);
    const payload = { portfolioId: pid, broker: "holdings", filename: "z.csv", content: ZERODHA };
    await post("/api/imports/commit", cookie, payload);
    const second = (await post("/api/imports/commit", cookie, payload)).json();
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(2);
  });

  it("declines a tradebook file (has trade type/date columns)", async () => {
    const cookie = await signup("hs4");
    const pid = await mkPortfolio(cookie);
    const tradebook = "symbol,trade_type,quantity,price,trade_date\nINFY,buy,10,1500,2024-01-01";
    const res = await post("/api/imports/check", cookie, { portfolioId: pid, broker: "holdings", filename: "t.csv", content: tradebook });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("format_unrecognized");
  });
});
