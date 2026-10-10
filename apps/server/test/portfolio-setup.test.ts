import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
let cookie: string;
beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db);
  await app.ready();
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "setup1", password: "supersecret1" } });
  cookie = String(res.headers["set-cookie"]).split(";")[0]!;
});

describe("setting up a person with their brokers", () => {
  it("creates the person and one account per broker in one step", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      headers: { cookie },
      payload: { name: "Manan", kind: "custom", accounts: [{ name: "Zerodha", broker: "zerodha" }, { name: "Vested", broker: "vested", currency: "usd" }] },
    });
    expect(res.statusCode).toBe(201);
    const pid = res.json().portfolio.id;
    const accounts = (await app.inject({ method: "GET", url: `/api/accounts?portfolioId=${pid}`, headers: { cookie } })).json().accounts;
    expect(accounts.map((a: { broker: string; currency: string }) => `${a.broker}:${a.currency}`).sort()).toEqual(["vested:USD", "zerodha:INR"]);
  });

  it("rejects an unknown broker without creating anyone", async () => {
    const res = await app.inject({ method: "POST", url: "/api/portfolios", headers: { cookie }, payload: { name: "Manan", accounts: [{ name: "X", broker: "nope" }] } });
    expect(res.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/portfolios", headers: { cookie } })).json().portfolios).toHaveLength(0);
  });
});
