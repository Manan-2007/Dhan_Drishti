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

beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db);
  await app.ready();
});

describe("GET /api/transactions — enrichment", () => {
  it("includes the security's symbol/name so a row is self-describing, not just an id", async () => {
    const cookie = await signup("tx-enrich-1");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sec = (await post("/api/securities", cookie, { symbol: "INFY", name: "Infosys Ltd", assetClass: "equity", isin: "INE009A01021" })).json().security;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sec.id, type: "buy", tradeDate: "2024-01-01", quantity: "10", price: "100" });

    const res = await get("/api/transactions", cookie);
    const [tx] = res.json().transactions;
    expect(tx.security).toMatchObject({ symbol: "INFY", name: "Infosys Ltd", isin: "INE009A01021", assetClass: "equity" });
  });

  it("includes the account's name/broker when the transaction is tied to one", async () => {
    const cookie = await signup("tx-enrich-2");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const acc = (await post("/api/accounts", cookie, { portfolioId: pid, name: "My Zerodha", broker: "zerodha" })).json().account;
    const sec = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS Ltd", assetClass: "equity" })).json().security;
    await post("/api/transactions", cookie, { portfolioId: pid, accountId: acc.id, securityId: sec.id, type: "buy", tradeDate: "2024-01-01", quantity: "5", price: "300" });

    const res = await get("/api/transactions", cookie);
    const [tx] = res.json().transactions;
    expect(tx.account).toMatchObject({ name: "My Zerodha", broker: "zerodha" });
  });

  it("leaves security/account null for a pure-cash row (deposit) rather than erroring", async () => {
    const cookie = await signup("tx-enrich-3");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    await post("/api/transactions", cookie, { portfolioId: pid, type: "deposit", tradeDate: "2024-01-01", grossAmount: "1000" });

    const res = await get("/api/transactions", cookie);
    const [tx] = res.json().transactions;
    expect(tx.security).toBeNull();
    expect(tx.account).toBeNull();
  });

  it("resolves distinct securities correctly across multiple rows (no cross-contamination)", async () => {
    const cookie = await signup("tx-enrich-4");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const infy = (await post("/api/securities", cookie, { symbol: "INFY", name: "Infosys", assetClass: "equity" })).json().security;
    const tcs = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: infy.id, type: "buy", tradeDate: "2024-01-01", quantity: "1", price: "100" });
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: tcs.id, type: "buy", tradeDate: "2024-01-02", quantity: "1", price: "300" });

    const res = await get("/api/transactions", cookie);
    const symbols = res.json().transactions.map((t: { security: { symbol: string } | null }) => t.security?.symbol).sort();
    expect(symbols).toEqual(["INFY", "TCS"]);
  });
});
