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

const reg = (headers: Record<string, string> = {}, username = "sec" + Math.random().toString(36).slice(2, 8)) =>
  app.inject({ method: "POST", url: "/api/auth/register", headers, payload: { username, password: "supersecret1" } });

describe("security hardening", () => {
  it("sets security headers on responses", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it("blocks a cross-origin mutating request (CSRF guard)", async () => {
    const res = await reg({ origin: "https://evil.example" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("cross_origin_blocked");
  });

  it("allows a same-origin request", async () => {
    const res = await reg({ origin: "http://localhost" });
    expect(res.statusCode).toBe(201);
  });

  it("treats loopback hosts (dev proxy) as same-origin", async () => {
    const res = await reg({ origin: "http://localhost:5173" }); // host defaults to localhost
    expect(res.statusCode).toBe(201);
  });

  it("allows requests with no Origin (headless/native API clients)", async () => {
    const res = await reg();
    expect(res.statusCode).toBe(201);
  });

  it("does not block GET requests by origin", async () => {
    const res = await app.inject({ method: "GET", url: "/api", headers: { origin: "https://evil.example" } });
    expect(res.statusCode).toBe(200);
  });

  it("rate-limits repeated auth attempts", async () => {
    let sawLimit = false;
    for (let i = 0; i < 40; i++) {
      const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "nobody", password: "wrongpass1" } });
      if (res.statusCode === 429) {
        sawLimit = true;
        expect(res.json().error).toBe("rate_limited");
        break;
      }
    }
    expect(sawLimit).toBe(true);
  });
});
