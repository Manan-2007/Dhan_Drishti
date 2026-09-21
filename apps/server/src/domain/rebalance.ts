import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { d, ZERO, type Decimal } from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { allocationTargets } from "../db/schema.js";
import { authed } from "../lib/routes.js";
import { BadRequestError } from "../lib/errors.js";
import { getPortfolioOwned } from "./portfolios.js";
import { computePortfolioHoldings } from "./holdings.js";

/**
 * Rebalancing: compare the live allocation (from the holdings engine) against user-set target
 * weights, and report the drift in both weight and rupees ("trim ₹X" / "add ₹X"). Targets are
 * plain weights the user chooses; every current figure traces to real priced holdings.
 */

const DIMENSIONS = ["asset_class", "sector"] as const;
type Dimension = (typeof DIMENSIONS)[number];
const dimensionSchema = z.enum(DIMENSIONS).default("asset_class");

const querySchema = z.object({ portfolioId: z.string().optional(), dimension: dimensionSchema });
const weightStr = z
  .string()
  .trim()
  .refine((s) => s !== "" && Number.isFinite(Number(s)) && Number(s) >= 0 && Number(s) <= 1, "weight must be between 0 and 1");
const putSchema = z.object({
  portfolioId: z.string().optional(),
  dimension: dimensionSchema,
  targets: z.array(z.object({ key: z.string().trim().min(1).max(64), weight: weightStr })).max(64),
});

const allocField = (dim: Dimension): "byAssetClass" | "bySector" => (dim === "asset_class" ? "byAssetClass" : "bySector");

/** Existing target weights for a scope+dimension, as key → decimal-string weight. */
async function getTargets(db: DB, userId: string, portfolioId: string | null, dimension: Dimension): Promise<Map<string, string>> {
  const rows = await db
    .select()
    .from(allocationTargets)
    .where(
      and(
        eq(allocationTargets.userId, userId),
        eq(allocationTargets.dimension, dimension),
        portfolioId === null ? isNull(allocationTargets.portfolioId) : eq(allocationTargets.portfolioId, portfolioId),
      ),
    )
    .all();
  return new Map(rows.map((r) => [r.key, r.targetWeight]));
}

export async function computeRebalance(db: DB, userId: string, portfolioId: string | undefined, dimension: Dimension) {
  const holdings = await computePortfolioHoldings(db, userId, portfolioId);
  const slices = holdings.allocation[allocField(dimension)];
  const total = slices.reduce((acc, s) => acc.plus(d(s.value)), ZERO);
  const currentByKey = new Map(slices.map((s) => [s.key, s]));
  const targets = await getTargets(db, userId, portfolioId ?? null, dimension);

  const keys = [...new Set([...currentByKey.keys(), ...targets.keys()])];
  const rows = keys.map((key) => {
    const cur = currentByKey.get(key);
    const currentValue = cur ? d(cur.value) : ZERO;
    const currentWeight = cur ? d(cur.weight) : ZERO;
    const targetWeight: Decimal | null = targets.has(key) ? d(targets.get(key)!) : null;
    const targetValue = targetWeight ? targetWeight.times(total) : null;
    const driftWeight = targetWeight ? currentWeight.minus(targetWeight) : null; // + = over target
    const driftValue = targetValue ? currentValue.minus(targetValue) : null; // + = trim, − = add
    const action = driftValue ? (driftValue.greaterThan(0) ? "trim" : driftValue.lessThan(0) ? "add" : "hold") : null;
    return {
      key,
      currentValue: currentValue.toFixed(),
      currentWeight: currentWeight.toFixed(),
      targetWeight: targetWeight ? targetWeight.toFixed() : null,
      targetValue: targetValue ? targetValue.toFixed() : null,
      driftWeight: driftWeight ? driftWeight.toFixed() : null,
      driftValue: driftValue ? driftValue.toFixed() : null,
      action,
    };
  });

  // Targeted rows first, largest rupee drift on top; untargeted rows after, by current value.
  rows.sort((a, b) => {
    const at = a.targetWeight !== null ? 0 : 1;
    const bt = b.targetWeight !== null ? 0 : 1;
    if (at !== bt) return at - bt;
    if (at === 0) return Math.abs(Number(b.driftValue)) - Math.abs(Number(a.driftValue));
    return Number(b.currentValue) - Number(a.currentValue);
  });

  const targetSum = [...targets.values()].reduce((acc, w) => acc.plus(d(w)), ZERO);
  return {
    dimension,
    basis: holdings.allocation.basis,
    baseCurrency: holdings.baseCurrency,
    totalValue: total.toFixed(),
    hasTargets: targets.size > 0,
    targetSum: targetSum.toFixed(),
    untargetedWeight: d(1).minus(targetSum).toFixed(), // portion of the portfolio with no target (may be < 0 if over-allocated)
    rows,
  };
}

async function replaceTargets(
  db: DB,
  userId: string,
  portfolioId: string | null,
  dimension: Dimension,
  targets: { key: string; weight: string }[],
): Promise<void> {
  await db
    .delete(allocationTargets)
    .where(
      and(
        eq(allocationTargets.userId, userId),
        eq(allocationTargets.dimension, dimension),
        portfolioId === null ? isNull(allocationTargets.portfolioId) : eq(allocationTargets.portfolioId, portfolioId),
      ),
    )
    .run();
  const now = new Date().toISOString();
  // Keep only positive weights; a 0 means "no target" and is simply dropped.
  const seen = new Set<string>();
  for (const t of targets) {
    if (seen.has(t.key) || !d(t.weight).greaterThan(0)) continue;
    seen.add(t.key);
    await db
      .insert(allocationTargets)
      .values({ id: randomUUID(), userId, portfolioId, dimension, key: t.key, targetWeight: t.weight, createdAt: now, updatedAt: now })
      .run();
  }
}

export function registerRebalanceRoutes(app: FastifyInstance, db: DB): void {
  const opts = authed(app);

  app.get("/api/rebalance", opts, async (req) => {
    const { portfolioId, dimension } = querySchema.parse(req.query);
    if (portfolioId) await getPortfolioOwned(db, req.user!.id, portfolioId);
    return computeRebalance(db, req.user!.id, portfolioId, dimension);
  });

  app.put("/api/rebalance", opts, async (req) => {
    const body = putSchema.parse(req.body);
    const userId = req.user!.id;
    if (body.portfolioId) await getPortfolioOwned(db, userId, body.portfolioId);
    const sum = body.targets.reduce((acc, t) => acc.plus(d(t.weight)), ZERO);
    if (sum.greaterThan(d("1.0001"))) {
      throw new BadRequestError("targets_over_100", `Target weights add up to ${sum.times(100).toFixed(1)}% — they can't exceed 100%.`);
    }
    await replaceTargets(db, userId, body.portfolioId ?? null, body.dimension, body.targets);
    return computeRebalance(db, userId, body.portfolioId, body.dimension);
  });
}
