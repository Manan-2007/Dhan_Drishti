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

describe("deposits and bonds", () => {
  it("values an FD from its amount, rate and dates, and flags it near maturity", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "fd1", password: "supersecret1" } });
    const raw = res.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0]! : (raw as string)).split(";")[0]!;
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const created = await app.inject({
      method: "POST",
      url: "/api/manual-assets",
      headers: { cookie },
      payload: { name: "SBI FD", assetClass: "fd", cost: "100000", interestRate: "7", startDate: day(-345), maturityDate: day(20), compounding: "quarterly" },
    });
    expect(created.statusCode).toBe(201);

    const r = (await app.inject({ method: "GET", url: "/api/manual-assets", headers: { cookie } })).json();
    const fd = r.items[0];
    expect(Number(fd.currentValue)).toBeGreaterThan(106500); // ~345 days at 7% quarterly
    expect(Number(fd.currentValue)).toBeLessThan(107000);
    expect(fd.deposit).toMatchObject({ interestRate: "7", daysToMaturity: 20, matured: false, compounding: "quarterly" });
    expect(Number(fd.deposit.maturityValue)).toBeGreaterThan(Number(fd.currentValue));
    expect(r.maturing).toEqual([expect.objectContaining({ name: "SBI FD", daysToMaturity: 20 })]);

    // It counts in net worth at its worked-out value.
    const h = (await app.inject({ method: "GET", url: "/api/holdings", headers: { cookie } })).json();
    expect(Number(h.summary.manualAssets)).toBeCloseTo(Number(fd.currentValue), 2);
  });

  it("still needs either a value or full terms", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "fd2", password: "supersecret1" } });
    const raw = res.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0]! : (raw as string)).split(";")[0]!;
    const bad = await app.inject({ method: "POST", url: "/api/manual-assets", headers: { cookie }, payload: { name: "FD", assetClass: "fd", interestRate: "7" } });
    expect(bad.statusCode).toBe(400);
  });
});
