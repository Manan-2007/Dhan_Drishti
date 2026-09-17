import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;

async function signup(username: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { username, password: "supersecret1" },
  });
  const raw = res.headers["set-cookie"];
  const line = Array.isArray(raw) ? raw[0]! : (raw as string);
  return line.split(";")[0]!;
}

async function post(url: string, cookie: string, payload: unknown) {
  return app.inject({ method: "POST", url, headers: { cookie }, payload });
}
async function get(url: string, cookie: string) {
  return app.inject({ method: "GET", url, headers: { cookie } });
}

beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db);
  await app.ready();
});

describe("portfolios", () => {
  it("creates, lists, updates, and deletes (owner-scoped)", async () => {
    const cookie = await signup("alice");
    const created = await post("/api/portfolios", cookie, { name: "Zerodha", kind: "broker" });
    expect(created.statusCode).toBe(201);
    const id = created.json().portfolio.id;

    const list = await get("/api/portfolios", cookie);
    expect(list.json().portfolios).toHaveLength(1);

    const upd = await app.inject({
      method: "PUT",
      url: `/api/portfolios/${id}`,
      headers: { cookie },
      payload: { description: "Long term" },
    });
    expect(upd.json().portfolio.description).toBe("Long term");

    const del = await app.inject({ method: "DELETE", url: `/api/portfolios/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    expect((await get("/api/portfolios", cookie)).json().portfolios).toHaveLength(0);
  });

  it("rejects duplicate names and requires auth", async () => {
    const cookie = await signup("bob");
    await post("/api/portfolios", cookie, { name: "Dup" });
    const dup = await post("/api/portfolios", cookie, { name: "Dup" });
    expect(dup.statusCode).toBe(409);

    const anon = await app.inject({ method: "GET", url: "/api/portfolios" });
    expect(anon.statusCode).toBe(401);
  });

  it("isolates portfolios between users", async () => {
    const a = await signup("userA");
    const b = await signup("userB");
    const p = await post("/api/portfolios", a, { name: "Private" });
    const id = p.json().portfolio.id;
    const asB = await get(`/api/portfolios/${id}`, b);
    expect(asB.statusCode).toBe(404); // not visible to another user
  });
});

describe("accounts", () => {
  it("attaches to an owned portfolio and rejects foreign portfolios", async () => {
    const a = await signup("acctA");
    const b = await signup("acctB");
    const pa = (await post("/api/portfolios", a, { name: "PA" })).json().portfolio.id;

    const ok = await post("/api/accounts", a, { portfolioId: pa, name: "Main", broker: "zerodha" });
    expect(ok.statusCode).toBe(201);

    const foreign = await post("/api/accounts", b, { portfolioId: pa, name: "Sneaky" });
    expect(foreign.statusCode).toBe(404); // B can't see A's portfolio
  });
});

describe("securities", () => {
  it("find-or-creates by symbol and dedupes by ISIN", async () => {
    const cookie = await signup("secuser");
    const first = await post("/api/securities", cookie, {
      symbol: "INFY",
      name: "Infosys",
      isin: "INE009A01021",
      exchange: "NSE",
      assetClass: "equity",
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().created).toBe(true);

    const again = await post("/api/securities", cookie, { symbol: "INFY", name: "Infosys Ltd", isin: "INE009A01021" });
    expect(again.statusCode).toBe(200);
    expect(again.json().created).toBe(false);
    expect(again.json().security.id).toBe(first.json().security.id);
  });
});

describe("transactions ledger", () => {
  async function setup() {
    const cookie = await signup("ledger");
    const portfolioId = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const securityId = (
      await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })
    ).json().security.id;
    return { cookie, portfolioId, securityId };
  }

  it("records a buy and derives grossAmount", async () => {
    const { cookie, portfolioId, securityId } = await setup();
    const res = await post("/api/transactions", cookie, {
      portfolioId,
      securityId,
      type: "buy",
      tradeDate: "2024-01-15",
      quantity: "10",
      price: "100",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().transaction.grossAmount).toBe("1000");
  });

  it("enforces per-type invariants", async () => {
    const { cookie, portfolioId } = await setup();
    const noSec = await post("/api/transactions", cookie, {
      portfolioId,
      type: "buy",
      tradeDate: "2024-01-15",
      quantity: "10",
      price: "100",
    });
    expect(noSec.statusCode).toBe(400);
    expect(noSec.json().error).toBe("security_required");
  });

  it("filters by type and date range", async () => {
    const { cookie, portfolioId, securityId } = await setup();
    await post("/api/transactions", cookie, { portfolioId, securityId, type: "buy", tradeDate: "2024-01-01", quantity: "5", price: "100" });
    await post("/api/transactions", cookie, { portfolioId, securityId, type: "sell", tradeDate: "2024-06-01", quantity: "2", price: "150" });
    await post("/api/transactions", cookie, { portfolioId, securityId, type: "dividend", tradeDate: "2024-03-01", grossAmount: "50" });

    const all = await get(`/api/transactions?portfolioId=${portfolioId}`, cookie);
    expect(all.json().total).toBe(3);

    const sells = await get(`/api/transactions?portfolioId=${portfolioId}&type=sell`, cookie);
    expect(sells.json().transactions).toHaveLength(1);

    const q1 = await get(`/api/transactions?from=2024-01-01&to=2024-02-01`, cookie);
    expect(q1.json().transactions).toHaveLength(1);
  });

  it("keeps ledgers isolated between users", async () => {
    const { cookie, portfolioId, securityId } = await setup();
    await post("/api/transactions", cookie, { portfolioId, securityId, type: "buy", tradeDate: "2024-01-01", quantity: "5", price: "100" });
    const other = await signup("intruder");
    const res = await get(`/api/transactions`, other);
    expect(res.json().total).toBe(0);
  });
});
