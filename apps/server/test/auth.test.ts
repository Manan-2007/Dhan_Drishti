import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;

beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db);
  await app.ready();
});

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const line = Array.isArray(raw) ? raw[0]! : (raw as string);
  return line.split(";")[0]!; // "dd_session=..."
}

describe("health", () => {
  it("responds ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });
});

describe("auth flow", () => {
  it("registers, sets a session cookie, and returns the public user", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "manan", password: "supersecret1" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ username: "manan", baseCurrency: "INR" });
    expect(res.json().user.passwordHash).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeTruthy();
  });

  it("rejects a duplicate username", async () => {
    const payload = { username: "dup", password: "supersecret1" };
    await app.inject({ method: "POST", url: "/api/auth/register", payload });
    const res = await app.inject({ method: "POST", url: "/api/auth/register", payload });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("username_taken");
  });

  it("rejects weak passwords and short usernames", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "ok", password: "short" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation_error");
  });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "loginuser", password: "supersecret1" },
    });
    const good = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "loginuser", password: "supersecret1" },
    });
    expect(good.statusCode).toBe(200);

    const bad = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "loginuser", password: "wrongpassword" },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toBe("invalid_credentials");
  });

  it("does not leak whether an unknown username exists", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "ghost", password: "supersecret1" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_credentials");
  });

  it("guards /me and returns the user when authenticated", async () => {
    const anon = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(anon.statusCode).toBe(401);

    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "meuser", password: "supersecret1" },
    });
    const cookie = cookieFrom(reg);

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe("meuser");
  });

  it("logout invalidates the session", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "logoutuser", password: "supersecret1" },
    });
    const cookie = cookieFrom(reg);
    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });
});
