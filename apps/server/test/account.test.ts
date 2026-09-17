import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
async function register(u: string): Promise<string> {
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

describe("account export & delete", () => {
  it("exports the user's own data as JSON", async () => {
    const cookie = await register("expuser");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "TCS", name: "TCS", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-01-01", quantity: "10", price: "100" });

    const res = await get("/api/account/export", cookie);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    const data = res.json();
    expect(data.user.username).toBe("expuser");
    expect(data.portfolios).toHaveLength(1);
    expect(data.transactions).toHaveLength(1);
    expect(data.securities).toHaveLength(1);
    expect(data.user.passwordHash).toBeUndefined();
  });

  it("requires the correct password to delete, then removes all data", async () => {
    const cookie = await register("deluser");
    const pid = (await post("/api/portfolios", cookie, { name: "P" })).json().portfolio.id;
    const sid = (await post("/api/securities", cookie, { symbol: "X", name: "X", assetClass: "equity" })).json().security.id;
    await post("/api/transactions", cookie, { portfolioId: pid, securityId: sid, type: "buy", tradeDate: "2024-01-01", quantity: "1", price: "1" });

    const wrong = await post("/api/account/delete", cookie, { password: "nope12345" });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toBe("invalid_password");

    const ok = await post("/api/account/delete", cookie, { password: "supersecret1" });
    expect(ok.statusCode).toBe(200);

    // Session no longer valid; the account is gone.
    const me = await get("/api/auth/me", cookie);
    expect(me.statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "deluser", password: "supersecret1" } });
    expect(login.statusCode).toBe(401);
  });
});
