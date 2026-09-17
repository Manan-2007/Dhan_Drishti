import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { d, ZERO, safeDiv, toStore, type Decimal } from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { goals, goalPortfolios, type Goal } from "../db/schema.js";
import { authed } from "../lib/routes.js";
import { NotFoundError } from "../lib/errors.js";
import { getPortfolioOwned } from "./portfolios.js";
import { computePortfolioHoldings } from "./holdings.js";

const decimalStr = z.string().trim().refine((s) => s !== "" && Number.isFinite(Number(s)) && Number(s) > 0, "must be a positive number");
const dateStr = z.string().trim().refine((s) => !Number.isNaN(Date.parse(s)), "invalid date").transform((s) => new Date(s).toISOString());

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  targetAmount: decimalStr,
  targetDate: dateStr.nullable().optional(),
  currency: z.string().trim().length(3).toUpperCase().default("INR"),
  portfolioIds: z.array(z.string().min(1)).optional(),
});
const updateSchema = createSchema.partial();

async function getGoalOwned(db: DB, userId: string, id: string): Promise<Goal> {
  const row = await db.select().from(goals).where(and(eq(goals.id, id), eq(goals.userId, userId))).get();
  if (!row) throw new NotFoundError("Goal");
  return row;
}

async function linkedPortfolioIds(db: DB, goalId: string): Promise<string[]> {
  const rows = await db.select({ portfolioId: goalPortfolios.portfolioId }).from(goalPortfolios).where(eq(goalPortfolios.goalId, goalId)).all();
  return rows.map((r) => r.portfolioId);
}

/** Funded amount toward a goal from its funding portfolios (all of the user's if none linked). */
async function fundedAmount(db: DB, userId: string, portfolioIds: string[]): Promise<{ funded: Decimal; basis: "current_value" | "invested" }> {
  const scopes: (string | undefined)[] = portfolioIds.length ? portfolioIds : [undefined];
  let funded = ZERO;
  let allPriced = true;
  for (const pid of scopes) {
    const { summary } = await computePortfolioHoldings(db, userId, pid);
    const priced = summary.pricedPositions > 0 && summary.allPriced;
    funded = funded.plus(priced ? summary.currentValue : summary.invested);
    if (!priced && summary.openPositions > 0) allPriced = false;
  }
  return { funded, basis: allPriced ? "current_value" : "invested" };
}

function monthsUntil(iso: string): number {
  const target = new Date(iso).getTime();
  const now = Date.now();
  if (target <= now) return 0;
  return Math.max(1, Math.ceil((target - now) / (30.44 * 86_400_000)));
}

async function withProgress(db: DB, userId: string, goal: Goal) {
  const pids = await linkedPortfolioIds(db, goal.id);
  const { funded, basis } = await fundedAmount(db, userId, pids);
  const target = d(goal.targetAmount);
  const remaining = target.minus(funded);
  const progress = safeDiv(funded, target); // fraction, may exceed 1
  const months = goal.targetDate ? monthsUntil(goal.targetDate) : 0;
  const requiredMonthly = goal.targetDate && months > 0 && remaining.greaterThan(0) ? remaining.div(months) : null;
  return {
    ...goal,
    portfolioIds: pids,
    funded: toStore(funded),
    remaining: toStore(remaining.greaterThan(0) ? remaining : ZERO),
    progress: toStore(progress),
    basis,
    monthsRemaining: goal.targetDate ? months : null,
    requiredMonthly: toStore(requiredMonthly),
    reached: funded.greaterThanOrEqualTo(target),
  };
}

async function setLinks(db: DB, goalId: string, userId: string, portfolioIds: string[]): Promise<void> {
  await db.delete(goalPortfolios).where(eq(goalPortfolios.goalId, goalId)).run();
  for (const pid of [...new Set(portfolioIds)]) {
    await getPortfolioOwned(db, userId, pid); // ownership
    await db.insert(goalPortfolios).values({ goalId, portfolioId: pid }).run();
  }
}

export function registerGoalRoutes(app: FastifyInstance, db: DB): void {
  const opts = authed(app);

  app.get("/api/goals", opts, async (req) => {
    const rows = await db.select().from(goals).where(eq(goals.userId, req.user!.id)).all();
    return { goals: await Promise.all(rows.map((g) => withProgress(db, req.user!.id, g))) };
  });

  app.post("/api/goals", opts, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const userId = req.user!.id;
    const row = { id: randomUUID(), userId, name: body.name, targetAmount: body.targetAmount, targetDate: body.targetDate ?? null, currency: body.currency };
    await db.insert(goals).values(row).run();
    if (body.portfolioIds?.length) await setLinks(db, row.id, userId, body.portfolioIds);
    reply.code(201).send({ goal: await withProgress(db, userId, await getGoalOwned(db, userId, row.id)) });
  });

  app.get("/api/goals/:id", opts, async (req) => {
    const { id } = req.params as { id: string };
    return { goal: await withProgress(db, req.user!.id, await getGoalOwned(db, req.user!.id, id)) };
  });

  app.put("/api/goals/:id", opts, async (req) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    const body = updateSchema.parse(req.body);
    await getGoalOwned(db, userId, id);
    const { portfolioIds, ...fields } = body;
    if (Object.keys(fields).length) {
      await db.update(goals).set({ ...fields, updatedAt: new Date().toISOString() }).where(and(eq(goals.id, id), eq(goals.userId, userId))).run();
    }
    if (portfolioIds) await setLinks(db, id, userId, portfolioIds);
    return { goal: await withProgress(db, userId, await getGoalOwned(db, userId, id)) };
  });

  app.delete("/api/goals/:id", opts, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    await getGoalOwned(db, userId, id);
    await db.delete(goals).where(and(eq(goals.id, id), eq(goals.userId, userId))).run();
    reply.send({ ok: true });
  });
}
