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

const HDR = "Date,Scrip Name,Exchange,Buy Qty.,Buy Value,Sell Qty.,Sell Value,Brokerage";
const row = (date: string, name: string, qty: number, val: number) => `"${date}","${name}","NSE","${qty}","${val}","0","0","5"`;

beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db);
  await app.ready();
});

describe("import period is read from the file, not asked for", () => {
  it("reports the covered date range in the preview", async () => {
    const cookie = await signup("per1");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const csv = [HDR, row("05 Apr 2025 00:00:00", "Infosys (INFY)", 10, 15000), row("10 May 2025 00:00:00", "TCS (TCS)", 5, 17000)].join("\n");
    const preview = (await post("/api/imports/check", cookie, { portfolioId: pid, broker: "dhan-txn", filename: "t.csv", content: csv })).json();
    // Derived from the file's own dates (early April → mid May); exact calendar day is TZ-dependent.
    expect(preview.period).not.toBeNull();
    expect(preview.period.from.slice(0, 7)).toBe("2025-04");
    expect(preview.period.to.slice(0, 7)).toBe("2025-05");
    expect(Date.parse(preview.period.from)).toBeLessThan(Date.parse(preview.period.to));
  });

  it("overwrites the file's own date range on re-upload, without asking for dates", async () => {
    const cookie = await signup("per2");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;

    // A monthly file (April only).
    const april = [HDR, row("05 Apr 2025 00:00:00", "Infosys (INFY)", 10, 15000)].join("\n");
    await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "dhan-txn", filename: "apr.csv", content: april });

    // A wider file (April restated + May) with replace on and NO dates supplied.
    const yearToDate = [HDR, row("05 Apr 2025 00:00:00", "Infosys (INFY)", 20, 30000), row("10 May 2025 00:00:00", "TCS (TCS)", 5, 17000)].join("\n");
    const res = (await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "dhan-txn", filename: "fy.csv", content: yearToDate, replace: true })).json();

    expect(res.replaced).toBe(1); // the stale April row was cleared first
    expect(res.imported).toBe(2);

    // Net: exactly the second file's rows — the first April row didn't linger as a duplicate.
    const txns = (await get(`/api/transactions?portfolioId=${pid}`, cookie)).json();
    expect(txns.total).toBe(2);
  });
});
