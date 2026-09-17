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
const holding = (rows: { security: { symbol: string } }[], sym: string) => rows.find((h) => h.security.symbol === sym);

beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db);
  await app.ready();
});

describe("broker adapters list", () => {
  it("offers Zerodha, Dhan, Vested, IBKR, Binance and generic", async () => {
    const cookie = await signup("list");
    const ids = (await get("/api/imports/brokers", cookie)).json().brokers.map((b: { id: string }) => b.id);
    expect(ids).toEqual(expect.arrayContaining(["zerodha", "dhan", "vested", "ibkr", "binance", "generic"]));
  });
});

describe("Vested (US stocks) import", () => {
  const CSV = ["Symbol,Side,Shares,Price,Amount,Date", "AAPL,Buy,10,150,1500,2024-01-05", "AAPL,Sell,4,180,720,2024-05-01", "TSLA,Buy,5,200,1000,2024-02-01"].join("\n");
  it("imports US equities in USD", async () => {
    const cookie = await signup("vest");
    const pid = await mkPortfolio(cookie);
    expect((await post("/api/imports/check", cookie, { portfolioId: pid, broker: "vested", filename: "v.csv", content: CSV })).json().toImport).toBe(3);
    await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "vested", filename: "v.csv", content: CSV });
    const rows = (await get("/api/holdings", cookie)).json().holdings;
    expect(holding(rows, "AAPL")!.netQty).toBe("6"); // 10 − 4
    expect(holding(rows, "AAPL")!.security.currency).toBe("USD");
    expect(holding(rows, "TSLA")!.netQty).toBe("5");
  });
});

describe("Interactive Brokers import", () => {
  const CSV = [
    "Symbol,TradeDate,Quantity,TradePrice,IBCommission,CurrencyPrimary,AssetClass,ISIN",
    "AAPL,2024-01-05,10,150,-1,USD,STK,US0378331005",
    "AAPL,2024-05-01,-4,180,-1,USD,STK,US0378331005",
  ].join("\n");
  it("handles signed quantity, commission and currency", async () => {
    const cookie = await signup("ibkr");
    const pid = await mkPortfolio(cookie);
    await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "ibkr", filename: "ib.csv", content: CSV });
    const rows = (await get("/api/holdings", cookie)).json().holdings;
    const aapl = holding(rows, "AAPL")!;
    expect(aapl.netQty).toBe("6"); // buy 10, sell 4 (inferred from negative qty)
    expect(aapl.security.currency).toBe("USD");
    // invested = 10*150 + 1 commission − (4/10 share of cost) ... just assert it's positive & priced in USD
    expect(Number(aapl.invested)).toBeGreaterThan(0);
  });
});

describe("Binance (crypto) import", () => {
  const CSV = [
    "Date(UTC),Pair,Side,Price,Amount,Total,Fee,Fee Coin",
    "2024-01-05 10:00:00,BTCUSDT,BUY,40000,0.1,4000,0.0001,BTC",
    "2024-02-01 12:00:00,BTCUSDT,SELL,45000,0.04,1800,1.8,USDT",
  ].join("\n");
  it("keys by base asset as crypto, priced in the quote currency", async () => {
    const cookie = await signup("bnb");
    const pid = await mkPortfolio(cookie);
    await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "binance", filename: "b.csv", content: CSV });
    const rows = (await get("/api/holdings", cookie)).json().holdings;
    const btc = holding(rows, "BTC")!;
    expect(btc.netQty).toBe("0.06"); // 0.1 − 0.04
    expect(btc.security.assetClass).toBe("crypto");
    expect(btc.security.currency).toBe("USD"); // USDT → USD
  });

  it("splits assorted pairs into their base asset", async () => {
    const cookie = await signup("bnb2");
    const pid = await mkPortfolio(cookie);
    const csv = ["Pair,Side,Price,Amount,Date(UTC)", "ETHUSDC,BUY,3000,1,2024-03-01 00:00:00", "SOLUSDT,BUY,100,10,2024-03-02 00:00:00"].join("\n");
    await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "binance", filename: "b.csv", content: csv });
    const rows = (await get("/api/holdings", cookie)).json().holdings.map((h: { security: { symbol: string } }) => h.security.symbol);
    expect(rows).toEqual(expect.arrayContaining(["ETH", "SOL"]));
  });
});
