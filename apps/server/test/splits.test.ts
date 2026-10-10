import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";

// NFLX-style: bought at ~$1,200 in old shares; public data lists a 10:1 split; adjusted closes ~$120.
const splitSource = { id: "fake", async getSplits() { return [{ exDate: "2025-11-17", ratio: "10", label: "10:1" }]; } };
const historyProvider = { id: "fake", async getHistory(_s: unknown, from: string) { return [{ date: from, close: 118 }, { date: "2025-07-28", close: 118.2 }]; } };
const fxProvider = { id: "fake", async getRate() { return null; }, async getRateOn() { return null; } };

describe("splits from public data", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    const { db } = await createDb(":memory:");
    app = buildApp(db, { splitSource, historyProvider, fxProvider });
    await app.ready();
  });
  const login = async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "split1", password: "supersecret1" } });
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? raw[0]! : (raw as string)).split(";")[0]!;
  };
  const post = (cookie: string, url: string, payload: object) => app.inject({ method: "POST", url, headers: { cookie }, payload });

  it("fills in a split the files miss, once, and never again after it's removed", async () => {
    const cookie = await login();
    const pid = (await post(cookie, "/api/portfolios", { name: "P" })).json().portfolio.id;
    const sid = (await post(cookie, "/api/securities", { symbol: "NFLX", name: "Netflix", currency: "USD" })).json().security.id;
    await post(cookie, "/api/transactions", { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2025-07-28", quantity: "2", price: "1182", currency: "USD" });

    const r = (await post(cookie, "/api/splits/check", {})).json();
    expect(r.added).toEqual([{ securityId: sid, symbol: "NFLX", exDate: "2025-11-17", label: "10:1" }]);
    const h = (await app.inject({ method: "GET", url: "/api/holdings", headers: { cookie } })).json();
    expect(h.holdings[0].netQty).toBe("20");
    expect(h.holdings[0].avgCost).toBe("118.2");

    // Running again adds nothing.
    expect((await post(cookie, "/api/splits/check", {})).json().added).toEqual([]);

    // Removed by the user → stays removed.
    const txs = (await app.inject({ method: "GET", url: "/api/transactions", headers: { cookie } })).json().transactions;
    const split = txs.find((t: { type: string }) => t.type === "split");
    expect((await app.inject({ method: "DELETE", url: `/api/transactions/${split.id}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await post(cookie, "/api/splits/check", {})).json().added).toEqual([]);
  });

  it("leaves a split alone when the trades are already in the new shares", async () => {
    const cookie = await login();
    const pid = (await post(cookie, "/api/portfolios", { name: "P" })).json().portfolio.id;
    const sid = (await post(cookie, "/api/securities", { symbol: "NFLX", name: "Netflix", currency: "USD" })).json().security.id;
    await post(cookie, "/api/transactions", { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2025-07-28", quantity: "20", price: "118.2", currency: "USD" });
    const r = (await post(cookie, "/api/splits/check", {})).json();
    expect(r.added).toEqual([]);
    const h = (await app.inject({ method: "GET", url: "/api/holdings", headers: { cookie } })).json();
    expect(h.holdings[0].netQty).toBe("20");
  });
});
