import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const get = (url: string) => app.inject({ method: "GET", url });

beforeEach(async () => {
  const { db } = await createDb(":memory:");
  app = buildApp(db);
  await app.ready();
});

describe("API discovery & contract", () => {
  it("serves a public API index with the endpoint list", async () => {
    const res = await get("/api");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBeTruthy();
    expect(body.schema).toBe("/api/openapi.json");
    expect(body.endpoints).toContain("GET /api/holdings");
    expect(body.endpoints).toContain("POST /api/transactions");
  });

  it("serves the OpenAPI 3.1 document (no auth) matching real routes", async () => {
    const res = await get("/api/openapi.json");
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/api/holdings"].get).toBeTruthy();
    expect(spec.paths["/api/performance/benchmark"].get).toBeTruthy();
    expect(spec.components.securitySchemes.cookieAuth.name).toBe("dd_session");
  });

  it("returns a JSON 404 for unknown API routes", async () => {
    const res = await get("/api/does-not-exist");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "not_found" });
  });

  it("health check responds", async () => {
    const res = await get("/health");
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });
});
