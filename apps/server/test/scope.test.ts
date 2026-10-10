import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
let cookie: string;
const noFx = { id: "fake", async getRate() { return null; }, async getRateOn() { return null; } };
const post = (url: string, payload: object) => app.inject({ method: "POST", url, headers: { cookie }, payload });
const get = (url: string) => app.inject({ method: "GET", url, headers: { cookie } });
const symbols = async (qs: string) => ((await get(`/api/holdings${qs}`)).json().holdings as { security: { symbol: string } }[]).map((h) => h.security.symbol).sort();

let dad: string;
let mom: string;
beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db, { fxProvider: noFx });
  await app.ready();
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "scope1", password: "supersecret1" } });
  cookie = String(res.headers["set-cookie"]).split(";")[0]!;

  // Dad: Zerodha (INFY, INR) + Vested (AAPL, USD). Mom: Zerodha (TCS, INR).
  dad = (await post("/api/portfolios", { name: "Dad", kind: "family", accounts: [{ name: "Dad · Zerodha", broker: "zerodha" }, { name: "Dad · Vested", broker: "vested", currency: "USD" }] })).json().portfolio.id;
  mom = (await post("/api/portfolios", { name: "Mom", kind: "family", accounts: [{ name: "Mom · Zerodha", broker: "zerodha" }] })).json().portfolio.id;
  const accts = (await get("/api/accounts")).json().accounts as { id: string; name: string }[];
  const acc = (n: string) => accts.find((a) => a.name === n)!.id;
  const sec = async (symbol: string, currency = "INR") => (await post("/api/securities", { symbol, name: symbol, assetClass: "equity", currency })).json().security.id;
  const [infy, aapl, tcs] = [await sec("INFY"), await sec("AAPL", "USD"), await sec("TCS")];
  await post("/api/transactions", { portfolioId: dad, accountId: acc("Dad · Zerodha"), securityId: infy, type: "buy", tradeDate: "2025-01-01", quantity: "10", price: "1500" });
  await post("/api/transactions", { portfolioId: dad, accountId: acc("Dad · Vested"), securityId: aapl, type: "buy", tradeDate: "2025-01-01", quantity: "2", price: "200", currency: "USD" });
  await post("/api/transactions", { portfolioId: mom, accountId: acc("Mom · Zerodha"), securityId: tcs, type: "buy", tradeDate: "2025-01-01", quantity: "3", price: "3500" });
  await post("/api/manual-assets", { name: "Mom's FD", assetClass: "fd", currentValue: "100000", portfolioId: mom });
});

describe("filtering by people, brokers and market", () => {
  it("shows everyone by default, and one or several people on request", async () => {
    expect(await symbols("")).toEqual(["AAPL", "INFY", "TCS"]);
    expect(await symbols(`?portfolioId=${dad}`)).toEqual(["AAPL", "INFY"]); // the old single-person form still works
    expect(await symbols(`?portfolioIds=${dad},${mom}`)).toEqual(["AAPL", "INFY", "TCS"]);
  });

  it("filters by broker across people, and combines with people", async () => {
    expect(await symbols("?brokers=zerodha")).toEqual(["INFY", "TCS"]);
    expect(await symbols("?brokers=vested")).toEqual(["AAPL"]);
    expect(await symbols(`?brokers=zerodha&portfolioIds=${mom}`)).toEqual(["TCS"]);
  });

  it("filters by market — India is rupee trades, US is dollar trades", async () => {
    expect(await symbols("?market=in")).toEqual(["INFY", "TCS"]);
    expect(await symbols("?market=us")).toEqual(["AAPL"]);
    expect(await symbols(`?market=us&portfolioIds=${mom}`)).toEqual([]);
  });

  it("keeps manual assets with their person and market, but out of a broker filter", async () => {
    const manual = async (qs: string) => (await get(`/api/holdings${qs}`)).json().summary.manualAssets;
    expect(await manual("")).toBe("100000");
    expect(await manual(`?portfolioIds=${mom}`)).toBe("100000");
    expect(await manual(`?portfolioIds=${dad}`)).toBe("0");
    expect(await manual("?brokers=zerodha")).toBe("0"); // an FD isn't at a broker
    expect(await manual("?market=us")).toBe("0");
  });

  it("applies the same slice to every derived view", async () => {
    const perf = (await get("/api/performance/summary?market=in")).json();
    expect(perf.summary.openPositions).toBe(2);
    const activity = (await get("/api/transactions?brokers=vested")).json();
    expect(activity.transactions.map((t: { security: { symbol: string } }) => t.security.symbol)).toEqual(["AAPL"]);
  });

  it("refuses someone else's person, and an unknown broker", async () => {
    const other = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "scope2", password: "supersecret1" } });
    const otherCookie = String(other.headers["set-cookie"]).split(";")[0]!;
    const theirs = await app.inject({ method: "GET", url: `/api/holdings?portfolioIds=${dad}`, headers: { cookie: otherCookie } });
    expect(theirs.statusCode).toBe(404);
    expect((await get("/api/holdings?brokers=nope")).statusCode).toBe(400);
  });
});
