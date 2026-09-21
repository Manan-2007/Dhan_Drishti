import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { d, ZERO, toStore, type Decimal } from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { manualAssets, type ManualAsset } from "../db/schema.js";
import { authed } from "../lib/routes.js";
import { NotFoundError } from "../lib/errors.js";
import { baseCurrencyOf, rateMap } from "../market/fx.js";
import { getPortfolioOwned } from "./portfolios.js";

/**
 * Manual (non-market) assets: FDs, PPF, EPF, NPS, physical gold, real estate, savings, bonds —
 * anything with no market price, whose value the user maintains by hand. They fold into net worth
 * and allocation (see holdings.ts) but never touch the transaction ledger. Every figure is a
 * value the user entered; nothing is estimated.
 */

export const MANUAL_ASSET_CLASSES = ["fd", "ppf", "epf", "nps", "savings", "gold", "real_estate", "bond", "other"] as const;

/** Region inferred from a security's currency (manual assets carry their own explicit region). */
const REGION_BY_CURRENCY: Record<string, string> = {
  INR: "India",
  USD: "United States",
  GBP: "United Kingdom",
  EUR: "Europe",
  JPY: "Japan",
  SGD: "Singapore",
  AUD: "Australia",
  CAD: "Canada",
  HKD: "Hong Kong",
  CHF: "Switzerland",
  AED: "UAE",
};
export const regionForCurrency = (currency: string): string => REGION_BY_CURRENCY[currency] ?? "Other";

const decimalStr = z
  .string()
  .trim()
  .refine((s) => s !== "" && Number.isFinite(Number(s)) && Number(s) >= 0, "must be a non-negative number");
const dateStr = z
  .string()
  .trim()
  .refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s), "must be YYYY-MM-DD");

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  assetClass: z.enum(MANUAL_ASSET_CLASSES).default("other"),
  region: z.string().trim().min(1).max(60).default("India"),
  currency: z.string().trim().length(3).toUpperCase().default("INR"),
  currentValue: decimalStr,
  cost: decimalStr.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  valueAsOf: dateStr.nullable().optional(),
  portfolioId: z.string().min(1).nullable().optional(),
});
const updateSchema = createSchema.partial();

const querySchema = z.object({ portfolioId: z.string().optional() });

export interface ManualAssetView {
  id: string;
  name: string;
  assetClass: string;
  region: string;
  currency: string;
  currentValue: string;
  cost: string | null;
  baseValue: string | null;
  baseCost: string | null;
  gain: string | null;
  notes: string | null;
  valueAsOf: string | null;
  portfolioId: string | null;
}

export interface ManualAssetsResult {
  baseCurrency: string;
  fxComplete: boolean;
  unconvertibleCurrencies: string[];
  total: string; // base-currency sum of convertible values
  totalCost: string; // base-currency sum of known costs
  count: number;
  byAssetClass: { key: string; value: string }[]; // base-currency, for allocation folding
  byRegion: { key: string; value: string }[];
  items: ManualAssetView[];
}

async function getOwned(db: DB, userId: string, id: string): Promise<ManualAsset> {
  const row = await db.select().from(manualAssets).where(and(eq(manualAssets.id, id), eq(manualAssets.userId, userId))).get();
  if (!row) throw new NotFoundError("Manual asset");
  return row;
}

/**
 * Load + value the user's manual assets for a scope. `portfolioId` restricts to that portfolio;
 * omit it for every manual asset (the "all portfolios" aggregate includes unassigned ones).
 */
export async function computeManualAssets(db: DB, userId: string, portfolioId?: string): Promise<ManualAssetsResult> {
  const clauses = [eq(manualAssets.userId, userId)];
  if (portfolioId) clauses.push(eq(manualAssets.portfolioId, portfolioId));
  const rows = await db.select().from(manualAssets).where(and(...clauses)).all();

  const base = await baseCurrencyOf(db, userId);
  const rates = await rateMap(db, [...new Set(rows.map((r) => r.currency))], base);
  const toBase = (amount: Decimal, currency: string): Decimal | null => {
    if (currency === base) return amount;
    const rate = rates.get(currency) ?? null;
    return rate === null ? null : amount.times(rate);
  };

  let total = ZERO;
  let totalCost = ZERO;
  const unconvertible = new Set<string>();
  const byClass = new Map<string, Decimal>();
  const byRegion = new Map<string, Decimal>();

  const items: ManualAssetView[] = rows.map((r) => {
    const value = d(r.currentValue);
    const cost = r.cost !== null ? d(r.cost) : null;
    const baseValue = toBase(value, r.currency);
    const baseCost = cost !== null ? toBase(cost, r.currency) : null;
    if (baseValue === null) unconvertible.add(r.currency);
    else {
      total = total.plus(baseValue);
      byClass.set(r.assetClass, (byClass.get(r.assetClass) ?? ZERO).plus(baseValue));
      byRegion.set(r.region, (byRegion.get(r.region) ?? ZERO).plus(baseValue));
    }
    if (baseCost !== null) totalCost = totalCost.plus(baseCost);
    return {
      id: r.id,
      name: r.name,
      assetClass: r.assetClass,
      region: r.region,
      currency: r.currency,
      currentValue: value.toFixed(),
      cost: cost !== null ? cost.toFixed() : null,
      baseValue: baseValue === null ? null : baseValue.toFixed(),
      baseCost: baseCost === null ? null : baseCost.toFixed(),
      gain: baseValue !== null && baseCost !== null ? baseValue.minus(baseCost).toFixed() : null,
      notes: r.notes,
      valueAsOf: r.valueAsOf,
      portfolioId: r.portfolioId,
    };
  });

  const dimOut = (m: Map<string, Decimal>) =>
    [...m.entries()].map(([key, value]) => ({ key, value: value.toFixed() })).sort((a, b) => Number(b.value) - Number(a.value));

  return {
    baseCurrency: base,
    fxComplete: unconvertible.size === 0,
    unconvertibleCurrencies: [...unconvertible],
    total: total.toFixed(),
    totalCost: toStore(totalCost) ?? "0",
    count: rows.length,
    byAssetClass: dimOut(byClass),
    byRegion: dimOut(byRegion),
    items: items.sort((a, b) => Number(b.baseValue ?? 0) - Number(a.baseValue ?? 0)),
  };
}

export function registerManualAssetRoutes(app: FastifyInstance, db: DB): void {
  const opts = authed(app);

  app.get("/api/manual-assets", opts, async (req) => {
    const { portfolioId } = querySchema.parse(req.query);
    if (portfolioId) await getPortfolioOwned(db, req.user!.id, portfolioId);
    return computeManualAssets(db, req.user!.id, portfolioId);
  });

  app.post("/api/manual-assets", opts, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const userId = req.user!.id;
    if (body.portfolioId) await getPortfolioOwned(db, userId, body.portfolioId);
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      userId,
      portfolioId: body.portfolioId ?? null,
      name: body.name,
      assetClass: body.assetClass,
      region: body.region,
      currency: body.currency,
      currentValue: body.currentValue,
      cost: body.cost ?? null,
      notes: body.notes ?? null,
      valueAsOf: body.valueAsOf ?? now.slice(0, 10),
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(manualAssets).values(row).run();
    reply.code(201).send({ asset: await getOwned(db, userId, row.id) });
  });

  app.put("/api/manual-assets/:id", opts, async (req) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    const body = updateSchema.parse(req.body);
    await getOwned(db, userId, id);
    if (body.portfolioId) await getPortfolioOwned(db, userId, body.portfolioId);
    // A changed value stamps valueAsOf (unless the caller set it explicitly).
    const patch: Partial<ManualAsset> = { ...body, updatedAt: new Date().toISOString() };
    if (body.currentValue !== undefined && body.valueAsOf === undefined) patch.valueAsOf = new Date().toISOString().slice(0, 10);
    if (body.portfolioId !== undefined) patch.portfolioId = body.portfolioId ?? null;
    await db.update(manualAssets).set(patch).where(and(eq(manualAssets.id, id), eq(manualAssets.userId, userId))).run();
    return { asset: await getOwned(db, userId, id) };
  });

  app.delete("/api/manual-assets/:id", opts, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    await getOwned(db, userId, id);
    await db.delete(manualAssets).where(and(eq(manualAssets.id, id), eq(manualAssets.userId, userId))).run();
    reply.send({ ok: true });
  });
}
