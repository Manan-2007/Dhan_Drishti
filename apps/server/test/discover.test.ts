import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import type { TickerSource } from "../src/market/providers/yahoo-search.js";

const noFx = { id: "fake", async getRate() { return null; }, async getRateOn() { return null; } };
const sent: string[] = [];
const tickerSource: TickerSource = {
  id: "fake",
  async search(q) {
    sent.push(q);
    return [
      { ticker: "PLTR", name: "Palantir Technologies Inc.", exchange: "NASDAQ", market: "us", type: "Equity" },
      { ticker: "INFY.NS", name: "Infosys Limited", exchange: "NSE", market: "in", type: "Equity" },
    ];
  },
  async quote(ticker) {
    sent.push(ticker);
    return ticker === "PLTR" ? { ticker, name: "Palantir Technologies Inc.", currency: "USD", exchange: "NASDAQ", price: 209.05, prevClose: 198.78, asOf: "2026-10-09T20:00:00.000Z" } : null;
  },
  async history(ticker) {
    return ticker === "PLTR" ? Array.from({ length: 60 }, (_, i) => ({ date: new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10), close: 150 + i })) : [];
  },
};

let app: FastifyInstance;
let cookie: string;
const get = (url: string) => app.inject({ method: "GET", url, headers: { cookie } });
beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db, { fxProvider: noFx, tickerSource });
  await app.ready();
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "disc1", password: "supersecret1" } });
  cookie = String(res.headers["set-cookie"]).split(";")[0]!;
});

describe("search and research for any stock", () => {
  it("finds stocks, mapping ones you've traded back to your record", async () => {
    const pid = (await app.inject({ method: "POST", url: "/api/portfolios", headers: { cookie }, payload: { name: "Me" } })).json().portfolio.id;
    const infy = (await app.inject({ method: "POST", url: "/api/securities", headers: { cookie }, payload: { symbol: "INFY", name: "Infosys", exchange: "NSE" } })).json().security.id;
    await app.inject({ method: "POST", url: "/api/transactions", headers: { cookie }, payload: { portfolioId: pid, securityId: infy, type: "buy", tradeDate: "2025-01-01", quantity: "10", price: "1500" } });

    const r = (await get("/api/search?q=pal")).json();
    expect(r.live).toBe(true);
    expect(r.results.map((x: { ticker: string; securityId: string | null }) => [x.ticker, x.securityId])).toEqual([["PLTR", null], ["INFY.NS", infy]]);
    // Only what was typed went out.
    expect(sent).toEqual(["pal"]);
  });

  it("researches a stock you don't hold from public data", async () => {
    const r = (await get("/api/research/ticker/PLTR")).json();
    expect(r).toMatchObject({ ticker: "PLTR", market: "us", currency: "USD", securityId: null, quote: { price: 209.05 } });
    expect(r.history).toHaveLength(60);
    expect(r.technicals.bars).toBe(60);
    expect((await get("/api/research/ticker/NOPE.L")).statusCode).toBe(400); // not a market the app covers
    expect((await get("/api/research/ticker/ZZZZ")).statusCode).toBe(404);
  });
});
