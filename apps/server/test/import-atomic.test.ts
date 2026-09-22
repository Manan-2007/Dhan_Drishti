import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";

// Force a failure mid-commit: the security named FAILME blows up when the importer tries to
// resolve it. Everything else in the securities module stays real.
vi.mock("../src/domain/securities.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/domain/securities.js")>();
  return {
    ...actual,
    findOrCreateSecurity: async (db: Parameters<typeof actual.findOrCreateSecurity>[0], input: Parameters<typeof actual.findOrCreateSecurity>[1]) => {
      if (input.symbol === "FAILME") throw new Error("boom: simulated write failure");
      return actual.findOrCreateSecurity(db, input);
    },
  };
});

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

describe("import commit atomicity", () => {
  it("rolls back the whole import — including the replace-delete — when a write fails midway", async () => {
    const cookie = await signup("atomic1");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;

    // A good first import establishes one transaction in June.
    const fileA = "symbol,trade_date,trade_type,quantity,price\nGOODSTK,2024-06-02,buy,10,100\n";
    const first = await post("/api/imports/commit", cookie, { portfolioId: pid, broker: "zerodha", filename: "a.csv", content: fileA });
    expect(first.statusCode).toBe(201);
    expect((await get("/api/transactions", cookie)).json().total).toBe(1);

    // A replace import that covers June and would wipe GOODSTK, then insert two rows — but the
    // second (FAILME) throws partway, after GOODSTK has been deleted and GOODSTK2 inserted.
    const fileB = "symbol,trade_date,trade_type,quantity,price\nGOODSTK2,2024-06-01,buy,5,200\nFAILME,2024-06-03,buy,3,300\n";
    const failed = await post("/api/imports/commit", cookie, {
      portfolioId: pid,
      broker: "zerodha",
      filename: "b.csv",
      content: fileB,
      replace: true,
      from: "2024-06-01",
      to: "2024-06-30",
    });
    expect(failed.statusCode).toBe(500); // the simulated failure surfaces as an error

    // The ledger is exactly as it was before the failed import: GOODSTK survived (delete rolled
    // back), and neither GOODSTK2 nor FAILME was persisted (inserts rolled back).
    const txs = (await get("/api/transactions", cookie)).json();
    expect(txs.total).toBe(1);
    const symbols = txs.transactions.map((t: { security: { symbol: string } | null }) => t.security?.symbol);
    expect(symbols).toEqual(["GOODSTK"]);

    // The half-inserted security was rolled back too.
    const secs = (await get("/api/securities?query=GOODSTK2", cookie)).json();
    expect(secs.securities.some((s: { symbol: string }) => s.symbol === "GOODSTK2")).toBe(false);

    // The failed batch left no committed import record behind.
    const imports = (await get("/api/imports", cookie)).json();
    expect(imports.imports).toHaveLength(1); // only the first, successful import
  });
});
