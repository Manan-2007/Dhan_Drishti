import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import { classifyUsListing } from "../src/import/us-listings.js";

const noFx = { id: "fake", async getRate() { return null; }, async getRateOn() { return null; } };

describe("US listings reference", () => {
  it("knows a US share's name, sector and industry, in the same sectors as Indian shares", () => {
    expect(classifyUsListing("NVDA")).toMatchObject({ assetClass: "equity", name: "NVIDIA Corporation", sector: "IT", subSector: "Semiconductors" });
    expect(classifyUsListing("TSLA")).toMatchObject({ sector: "Auto" }); // Nasdaq says Industrials; the industry says auto
    expect(classifyUsListing("ZZZZZZ")).toBeNull();
  });

  it("puts well-known companies in their usual (GICS) sectors where Nasdaq's reads oddly", () => {
    expect(classifyUsListing("V")).toMatchObject({ name: "Visa Inc.", sector: "BFSI", subSector: "Payments" }); // Nasdaq: Consumer
    expect(classifyUsListing("PM")).toMatchObject({ sector: "FMCG", subSector: "Tobacco" }); // Nasdaq: Health care
    expect(classifyUsListing("GOOG")).toMatchObject({ sector: "Communication", subSector: "Interactive media" }); // Nasdaq: Technology
    expect(classifyUsListing("GE")).toMatchObject({ sector: "Defence" });
    expect(classifyUsListing("BRK.B")).toMatchObject({ sector: "BFSI" }); // not in the screener at all
  });

  it("recognises ETFs and groups them by what they hold", () => {
    expect(classifyUsListing("VOOG")).toMatchObject({ assetClass: "etf", sector: "Index", subSector: "S&P 500" });
    expect(classifyUsListing("SOXX")).toMatchObject({ assetClass: "etf", sector: "Sectorial", subSector: "Semiconductors" });
    expect(classifyUsListing("JEPQ")).toMatchObject({ assetClass: "etf", sector: "Income" });
    expect(classifyUsListing("EWY")).toMatchObject({ assetClass: "etf", sector: "Global", subSector: "South Korea" });
  });
});

describe("classifying US holdings", () => {
  let app: FastifyInstance;
  let cookie: string;
  beforeEach(async () => {
    const { db } = await createDb(":memory:");
    app = buildApp(db, { fxProvider: noFx });
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "usc1", password: "supersecret1" } });
    cookie = String(res.headers["set-cookie"]).split(";")[0]!;
  });
  const post = (url: string, payload: object) => app.inject({ method: "POST", url, headers: { cookie }, payload });

  it("fills a bare-ticker US share's name and sector, and files an ETF as an ETF", async () => {
    const pid = (await post("/api/portfolios", { name: "Me" })).json().portfolio.id;
    for (const sym of ["NVDA", "VOOG"]) {
      const sid = (await post("/api/securities", { symbol: sym, name: sym, currency: "USD" })).json().security.id;
      await post("/api/transactions", { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2025-01-02", quantity: "1", price: "100", currency: "USD", fxRateToBase: "85" });
    }
    expect((await post("/api/securities/reclassify", {})).json().updated).toBe(2);
    // A rate, so the US holdings count in the rupee breakdown.
    await app.inject({ method: "PUT", url: "/api/exchange-rates", headers: { cookie }, payload: { from: "USD", to: "INR", rate: "85" } });
    const h = (await app.inject({ method: "GET", url: "/api/holdings", headers: { cookie } })).json();
    const by = Object.fromEntries(h.holdings.map((x: { security: { symbol: string } }) => [x.security.symbol, x.security]));
    expect(by.NVDA).toMatchObject({ name: "NVIDIA Corporation", assetClass: "equity", sector: "IT", subSector: "Semiconductors" });
    expect(by.VOOG).toMatchObject({ name: "Vanguard S&P 500 Growth ETF", assetClass: "etf", sector: "Index" });
    expect(h.allocation.bySector.map((s: { key: string }) => s.key).sort()).toEqual(["IT", "Index"].sort());
  });
});
