import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb, type DB } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import { priceHistory, priceHistoryStatus } from "../src/db/schema.js";

let db: DB;
let app: FastifyInstance;
beforeEach(async () => {
  ({ db } = await createDb(":memory:"));
  app = buildApp(db);
  await app.ready();
});

describe("GET /api/performance/value-history", () => {
  it("rebuilds each day's value from the ledger and cached closes, F&O left out", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "vh1", password: "supersecret1" } });
    const raw = res.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0]! : (raw as string)).split(";")[0]!;
    const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload });
    const pid = (await post("/api/portfolios", { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", { symbol: "INFY", name: "Infosys", assetClass: "equity", exchange: "NSE" })).json().security.id;
    const fno = (await post("/api/securities", { symbol: "NIFTY25JUN25000CE", name: "NIFTY25JUN25000CE", assetClass: "other" })).json().security.id;
    await post("/api/transactions", { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2025-06-02", quantity: "10", price: "1500" });
    await post("/api/transactions", { portfolioId: pid, securityId: fno, type: "buy", tradeDate: "2025-06-02", quantity: "75", price: "100", segment: "fno" });
    await db.insert(priceHistory).values([
      { securityId: sid, date: "2025-06-02", close: "1520" },
      { securityId: sid, date: "2025-06-03", close: "1550" },
    ]).run();
    await db.insert(priceHistoryStatus).values({ securityId: sid, source: "test", firstDate: "2025-06-02", lastDate: "2025-06-03", fetchedAt: new Date().toISOString() }).run();

    const r = (await app.inject({ method: "GET", url: "/api/performance/value-history?range=max", headers: { cookie } })).json();
    expect(r).toMatchObject({ available: true, from: "2025-06-02", pending: 0 });
    expect(r.points[0]).toEqual({ date: "2025-06-02", value: 15200, invested: 15000 });
    expect(r.points[1]).toEqual({ date: "2025-06-03", value: 15500, invested: 15000 });
    expect(r.points.at(-1).value).toBe(15500); // no newer close: last known one carries forward
    expect(r.points.every((p: { date: string }) => ![0, 6].includes(new Date(`${p.date}T00:00:00Z`).getUTCDay()) || p === r.points.at(-1))).toBe(true);
  });
});
