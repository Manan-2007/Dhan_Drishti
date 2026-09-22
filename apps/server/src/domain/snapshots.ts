import { randomUUID } from "node:crypto";
import { and, eq, gte, isNull, asc } from "drizzle-orm";
import { d } from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { snapshots, portfolios } from "../db/schema.js";
import { computePortfolioHoldings } from "./holdings.js";

const todayISO = () => new Date().toISOString().slice(0, 10);

/** The values worth persisting for a day, derived from a computed holdings result. Uses cost as the
 *  holdings value when prices are missing, mirroring how the dashboard headline falls back. */
type HoldingsResult = Awaited<ReturnType<typeof computePortfolioHoldings>>;
function snapshotValues(h: HoldingsResult) {
  const s = h.summary;
  const holdingsValue = s.pricedPositions > 0 ? s.currentValue : s.invested;
  const cash = h.cashTracked ? s.cash : "0";
  const manualAssets = s.manualAssets ?? "0";
  const netWorth = d(holdingsValue).plus(d(cash)).plus(d(manualAssets)).toFixed();
  return { netWorth, holdingsValue, cash, manualAssets, invested: s.invested, currency: h.baseCurrency };
}

/** Upsert today's snapshot for a scope from an already-computed holdings result (no recompute). */
export async function upsertSnapshotFromHoldings(db: DB, userId: string, portfolioId: string | null, h: HoldingsResult): Promise<void> {
  const date = todayISO();
  const v = snapshotValues(h);
  const scope = portfolioId ? eq(snapshots.portfolioId, portfolioId) : isNull(snapshots.portfolioId);
  // Manual upsert: SQLite treats NULLs as distinct, so a NULL-portfolio unique index wouldn't fire.
  const existing = await db.select({ id: snapshots.id }).from(snapshots).where(and(eq(snapshots.userId, userId), scope, eq(snapshots.date, date))).get();
  if (existing) {
    await db.update(snapshots).set({ ...v, provider: "snapshot" }).where(eq(snapshots.id, existing.id)).run();
  } else {
    await db.insert(snapshots).values({ id: randomUUID(), userId, portfolioId, date, ...v, provider: "snapshot" }).run();
  }
}

// Dedup the read-triggered snapshot to at most once per scope per day per process, so a page that
// polls /api/holdings doesn't turn every read into a write. The daily point is captured on the
// first view; the login refresh and the nightly cron keep it updated to the latest value.
const snapshotDay = new Map<string, string>();

/** Record today's snapshot from a holdings read, but only the first time per scope per day. */
export async function recordSnapshotOnRead(db: DB, userId: string, portfolioId: string | null, h: HoldingsResult): Promise<void> {
  const key = `${userId}|${portfolioId ?? ""}`;
  const today = todayISO();
  if (snapshotDay.get(key) === today) return;
  await upsertSnapshotFromHoldings(db, userId, portfolioId, h);
  snapshotDay.set(key, today);
}

/** Compute and record today's snapshot for one scope. */
export async function writeSnapshot(db: DB, userId: string, portfolioId?: string): Promise<void> {
  const h = await computePortfolioHoldings(db, userId, portfolioId);
  await upsertSnapshotFromHoldings(db, userId, portfolioId ?? null, h);
}

/** Record today's snapshot for the aggregate ("all portfolios") and each individual portfolio. */
export async function writeAllScopes(db: DB, userId: string): Promise<void> {
  await writeSnapshot(db, userId); // aggregate (portfolioId NULL)
  const pfs = await db.select({ id: portfolios.id }).from(portfolios).where(eq(portfolios.userId, userId)).all();
  for (const p of pfs) await writeSnapshot(db, userId, p.id);
}

export interface NetWorthPoint {
  date: string;
  netWorth: string;
  holdingsValue: string;
  cash: string;
  manualAssets: string;
  invested: string;
}

/** The stored net-worth series for a scope, oldest first, optionally from a start date. */
export async function getNetWorthSeries(db: DB, userId: string, portfolioId?: string, from?: string): Promise<{ currency: string; series: NetWorthPoint[] }> {
  const scope = portfolioId ? eq(snapshots.portfolioId, portfolioId) : isNull(snapshots.portfolioId);
  const clauses = [eq(snapshots.userId, userId), scope];
  if (from) clauses.push(gte(snapshots.date, from));
  const rows = await db.select().from(snapshots).where(and(...clauses)).orderBy(asc(snapshots.date)).all();
  return {
    currency: rows[0]?.currency ?? "INR",
    series: rows.map((r) => ({ date: r.date, netWorth: r.netWorth, holdingsValue: r.holdingsValue, cash: r.cash, manualAssets: r.manualAssets, invested: r.invested })),
  };
}
