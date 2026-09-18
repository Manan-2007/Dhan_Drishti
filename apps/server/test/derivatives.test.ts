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

describe("F&O lands in a Derivatives bucket, not Unclassified or its underlying's sector", () => {
  it("classifies an F&O contract by its segment even when its name echoes the underlying", async () => {
    const cookie = await signup("fno1");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;

    // Dhan transaction report: one open equity buy and one open F&O option buy whose name says "BANK".
    const csv = [
      "Date,Scrip Name,Exchange,Buy Qty.,Buy Value,Sell Qty.,Sell Value,Brokerage",
      '"01 Apr 2025 00:00:00","HDFC Bank (HDFCBANK)","NSE","10","6000","0","0","5"',
      '"01 Apr 2025 00:00:00","BANKNIFTY OPT (BANKNIFTY)","NSE","25","5000","0","0","20"',
    ].join("\n");
    await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "dhan-txn", filename: "t.csv", content: csv });

    const h = (await get("/api/holdings", cookie)).json();
    const bank = h.holdings.find((x: { security: { symbol: string } }) => x.security.symbol === "HDFCBANK")!;
    const fno = h.holdings.find((x: { security: { symbol: string } }) => x.security.symbol === "BANKNIFTY")!;

    expect(bank.security.sector).toBe("Financials"); // the cash equity keeps its real sector
    expect(fno.security.sector).toBe("Derivatives"); // the option is Derivatives, not "Financials"/Unclassified
    expect(fno.security.assetClass).toBe("other");

    // And it surfaces as its own allocation slice.
    const deriv = h.allocation.bySector.find((s: { key: string }) => s.key === "Derivatives");
    expect(deriv).toBeTruthy();
  });
});
