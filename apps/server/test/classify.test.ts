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

describe("security classification & sector allocation", () => {
  it("classifies securities from a reference CSV and drives sector allocation", async () => {
    const cookie = await signup("classify1");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const hdfc = (await post("/api/securities", cookie, { symbol: "HDFCBANK", name: "HDFCBANK", assetClass: "equity" })).json().security.id;
    const tcs = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: hdfc, type: "buy", tradeDate: "2024-01-01", quantity: "10", price: "100" });
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: tcs, type: "buy", tradeDate: "2024-01-01", quantity: "10", price: "300" });

    // Before classification: everything is Unclassified.
    let alloc = (await get("/api/holdings", cookie)).json().allocation;
    expect(alloc.bySector).toEqual([{ key: "Unclassified", value: "4000", weight: "1" }]);

    const csv = [
      "symbol,name,asset_class,sector",
      "HDFCBANK,HDFC Bank,equity,BFSI",
      "TCS,Tata Consultancy,equity,IT",
      "GHOST,Nobody,equity,Nowhere",
    ].join("\n");
    const res = await post("/api/securities/classify", cookie, { content: csv });
    expect(res.json().updated).toBe(2);
    expect(res.json().notFoundCount).toBe(1); // GHOST not held

    // After: sectors populate and allocation splits BFSI (1000) vs IT (3000).
    alloc = (await get("/api/holdings", cookie)).json().allocation;
    const bfsi = alloc.bySector.find((s: { key: string }) => s.key === "BFSI");
    const it = alloc.bySector.find((s: { key: string }) => s.key === "IT");
    expect(bfsi.value).toBe("1000");
    expect(it.value).toBe("3000");
    expect(it.weight).toBe("0.75");
  });

  it("edits a single security's metadata", async () => {
    const cookie = await signup("classify2");
    const sid = (await post("/api/securities", cookie, { symbol: "SBIN", name: "SBIN", assetClass: "equity" })).json().security.id;
    const res = await app.inject({ method: "PUT", url: `/api/securities/${sid}`, headers: { cookie }, payload: { sector: "BFSI", name: "State Bank of India" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().security.sector).toBe("BFSI");
    expect(res.json().security.name).toBe("State Bank of India");
  });
});
