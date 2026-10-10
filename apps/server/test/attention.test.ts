import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";

const noFx = { id: "fake", async getRate() { return null; }, async getRateOn() { return null; } };
const HEAD = "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time";
const row = (sym: string, isin: string, date: string, side: string, qty: number, price: number, id: number) => `${sym},${isin},${date},NSE,EQ,EQ,${side},false,${qty},${price},${id},${id},${date}T09:30:00`;

let app: FastifyInstance;
let cookie: string;
const post = (url: string, payload: object) => app.inject({ method: "POST", url, headers: { cookie }, payload });
const get = (url: string) => app.inject({ method: "GET", url, headers: { cookie } });

beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db, { fxProvider: noFx });
  await app.ready();
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "attn1", password: "supersecret1" } });
  cookie = String(res.headers["set-cookie"]).split(";")[0]!;
});

describe("needs attention", () => {
  it("pins down what's missing: the stock, the account, and the file with its dates", async () => {
    await post("/api/portfolios", { name: "Me", kind: "custom", accounts: [{ name: "Zerodha", broker: "zerodha" }, { name: "Dhan", broker: "dhan" }] });
    const accts = (await get("/api/accounts")).json().accounts as { id: string; name: string }[];
    const zerodha = accts.find((a) => a.name === "Zerodha")!.id;
    // Two files with a gap between them (Jun–Nov 2024), a sale of shares bought before the files, ending long ago.
    const fileA = [HEAD, row("INFY", "INE009A01021", "2024-04-02", "buy", 10, 1500, 1), row("ITC", "INE154A01025", "2024-04-05", "sell", 20, 430, 2), row("INFY", "INE009A01021", "2024-05-20", "buy", 5, 1450, 3)].join("\n");
    const fileB = [HEAD, row("INFY", "INE009A01021", "2024-12-02", "buy", 2, 1800, 4), row("INFY", "INE009A01021", "2025-01-10", "buy", 1, 1850, 5)].join("\n");
    for (const [filename, content] of [["tradebook-A.csv", fileA], ["tradebook-B.csv", fileB]] as const) {
      const r = await post("/api/imports/commit-many", { items: [{ filename, content, kind: "transactions", adapter: "zerodha", target: { accountId: zerodha } }] });
      expect(r.statusCode).toBe(201);
    }

    const { items } = (await get("/api/attention")).json() as { items: { kind: string; account: { name: string } | null; stocks: { symbol: string; note?: string }[]; need: { from: string | null; to: string | null; guide: string | null } | null }[] };
    const of = (kind: string) => items.find((i) => i.kind === kind)!;

    const missing = of("missing_buys");
    expect(missing.account!.name).toBe("Zerodha");
    expect(missing.stocks).toEqual([{ id: expect.any(String), name: expect.any(String), symbol: "ITC", note: expect.stringContaining("20 sold from 5 Apr 2024") }]);
    expect(missing.need).toMatchObject({ guide: "zerodha", from: null, to: "2024-04-01" });

    expect(of("file_gap").need).toMatchObject({ from: "2024-05-21", to: "2024-12-01" });
    expect(of("stale_files").need).toMatchObject({ from: "2025-01-11" });
    expect(of("no_files").account!.name).toBe("Dhan");
    expect(of("unpriced").stocks.map((s) => s.symbol)).toEqual(["INFY"]);

    // The broker filter narrows it to that broker's accounts.
    const dhanOnly = (await get("/api/attention?brokers=dhan")).json().items as { kind: string }[];
    expect(dhanOnly.map((i) => i.kind)).toEqual(["no_files"]);
  });
});
