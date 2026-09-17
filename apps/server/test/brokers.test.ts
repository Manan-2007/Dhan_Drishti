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

beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db);
  await app.ready();
});

describe("brokers list", () => {
  it("includes zerodha, dhan and generic", async () => {
    const cookie = await signup("brk");
    const ids = (await get("/api/imports/brokers", cookie)).json().brokers.map((b: { id: string }) => b.id);
    expect(ids).toEqual(expect.arrayContaining(["zerodha", "dhan", "generic"]));
  });
});

describe("Dhan tradebook import", () => {
  const CSV = [
    "Date,Time,Name,BuySell,Order,Exchange,Segment,Quantity,TradePrice,TradeValue,Status",
    "2023-05-05,11:22:44,J & K Bank,BUY,DELIVERY,NSE,Equity,100,60,6000,Traded",
    "2023-05-08,10:00:00,J & K Bank,SELL,DELIVERY,NSE,Equity,40,70,2800,Traded",
    "2023-04-28,10:00:58,Nippon India ETF Nifty,BUY,DELIVERY,NSE,Equity,5,28.77,143.85,Traded",
  ].join("\n");

  it("detects, imports and derives holdings by name", async () => {
    const cookie = await signup("dhanuser");
    const portfolioId = await mkPortfolio(cookie);
    const preview = await post("/api/imports/check", cookie, { portfolioId, broker: "dhan", filename: "dhan.csv", content: CSV });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().toImport).toBe(3);

    const commit = await post("/api/imports/commit", cookie, { portfolioId, broker: "dhan", filename: "dhan.csv", content: CSV });
    expect(commit.json().imported).toBe(3);

    const holdings = (await get("/api/holdings", cookie)).json().holdings;
    const jk = holdings.find((h: { security: { symbol: string } }) => h.security.symbol === "J & K BANK".toUpperCase());
    expect(jk.netQty).toBe("60"); // 100 - 40
  });

  it("rejects a Dhan file that isn't recognizable", async () => {
    const cookie = await signup("dhanbad");
    const portfolioId = await mkPortfolio(cookie);
    const res = await post("/api/imports/check", cookie, { portfolioId, broker: "dhan", filename: "x.csv", content: "a,b\n1,2" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("format_unrecognized");
  });
});

describe("Generic column-mapping import", () => {
  const CSV = [
    "Ticker;Side;Units;Rate;When",
    "AAPL;Bought;3;150.5;2024-02-01",
    "AAPL;Sold;1;170;2024-05-01",
  ].join("\n").replace(/;/g, ",");

  const mapping = { symbol: "Ticker", type: "Side", quantity: "Units", price: "Rate", date: "When", buyValues: ["Bought"], sellValues: ["Sold"], currency: "USD" };

  it("requires a mapping for generic", async () => {
    const cookie = await signup("gen0");
    const portfolioId = await mkPortfolio(cookie);
    const res = await post("/api/imports/check", cookie, { portfolioId, broker: "generic", filename: "g.csv", content: CSV });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("mapping_required");
  });

  it("imports using the provided mapping", async () => {
    const cookie = await signup("gen1");
    const portfolioId = await mkPortfolio(cookie);
    const preview = await post("/api/imports/check", cookie, { portfolioId, broker: "generic", filename: "g.csv", content: CSV, mapping });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().toImport).toBe(2);

    await post("/api/imports/commit", cookie, { portfolioId, broker: "generic", filename: "g.csv", content: CSV, mapping });
    const holdings = (await get("/api/holdings", cookie)).json().holdings;
    const aapl = holdings.find((h: { security: { symbol: string } }) => h.security.symbol === "AAPL");
    expect(aapl.netQty).toBe("2"); // 3 - 1
    expect(aapl.security.currency).toBe("USD");
  });
});
