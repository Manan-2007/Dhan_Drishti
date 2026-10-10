import { and, eq, inArray, ne, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB, Database } from "../db/index.js";
import { accounts, manualAssets, portfolios, transactions } from "../db/schema.js";
import { NotFoundError } from "../lib/errors.js";
import { BROKERS } from "./brokers.js";

/**
 * What slice of the user's money a request is about: some people (portfolios), some brokers, one
 * market. Everything is derived from the transaction ledger, so filtering the ledger once filters
 * every figure built on it — holdings, returns, tax, dividends, the X-ray, the charts.
 *
 * Empty / missing parts mean "all". The market is the trade's currency side: INR is India, any
 * other currency is the US (Vested and IBKR hold dollars) — the same split the News page uses.
 */
export interface Scope {
  portfolioIds?: string[];
  brokers?: string[];
  market?: "in" | "us";
}

/** Callers may still pass a single portfolio id (the old shape). */
export type ScopeArg = Scope | string | null | undefined;

export const toScope = (arg: ScopeArg): Scope => (typeof arg === "string" ? { portfolioIds: [arg] } : (arg ?? {}));

const list = z
  .string()
  .optional()
  .transform((s) => (s ? [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))] : undefined));

/** Query params every data endpoint accepts: `portfolioId` (one), `portfolioIds`, `brokers`, `market`. */
export const scopeQuery = z.object({
  portfolioId: z.string().min(1).optional(),
  portfolioIds: list,
  brokers: list.refine((b) => !b || b.every((x) => (BROKERS as readonly string[]).includes(x)), "unknown broker"),
  market: z.enum(["in", "us"]).optional(),
});

export function parseScope(query: unknown): Scope {
  const q = scopeQuery.parse(query ?? {});
  const ids = [...new Set([...(q.portfolioId ? [q.portfolioId] : []), ...(q.portfolioIds ?? [])])];
  return {
    ...(ids.length ? { portfolioIds: ids } : {}),
    ...(q.brokers?.length ? { brokers: q.brokers } : {}),
    ...(q.market ? { market: q.market } : {}),
  };
}

/** Every named person must be the caller's — otherwise 404, never another user's data. */
export async function assertScopeOwned(db: DB | Database, userId: string, scope: Scope): Promise<void> {
  if (!scope.portfolioIds?.length) return;
  const owned = await db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(and(eq(portfolios.userId, userId), inArray(portfolios.id, scope.portfolioIds)))
    .all();
  if (owned.length !== scope.portfolioIds.length) throw new NotFoundError("Portfolio");
}

/** Parse + ownership-check in one go, for routes. */
export async function scopeFromRequest(db: DB, userId: string, query: unknown): Promise<Scope> {
  const scope = parseScope(query);
  await assertScopeOwned(db, userId, scope);
  return scope;
}

/** Account ids at the chosen brokers (null when no broker filter). */
async function accountIdsFor(db: DB | Database, userId: string, scope: Scope): Promise<string[] | null> {
  if (!scope.brokers?.length) return null;
  const clauses = [eq(accounts.userId, userId), inArray(accounts.broker, scope.brokers as (typeof BROKERS)[number][])];
  if (scope.portfolioIds?.length) clauses.push(inArray(accounts.portfolioId, scope.portfolioIds));
  const rows = await db.select({ id: accounts.id }).from(accounts).where(and(...clauses)).all();
  return rows.map((r) => r.id);
}

/** WHERE clauses on `transactions` for the user and scope. */
export async function txScopeClauses(db: DB | Database, userId: string, arg: ScopeArg): Promise<SQL[]> {
  const scope = toScope(arg);
  const clauses: SQL[] = [eq(transactions.userId, userId)];
  if (scope.portfolioIds?.length) clauses.push(inArray(transactions.portfolioId, scope.portfolioIds));
  const accountIds = await accountIdsFor(db, userId, scope);
  if (accountIds) clauses.push(accountIds.length ? inArray(transactions.accountId, accountIds) : eq(transactions.id, "__none__"));
  if (scope.market === "in") clauses.push(eq(transactions.currency, "INR"));
  if (scope.market === "us") clauses.push(ne(transactions.currency, "INR"));
  return clauses;
}

/**
 * WHERE clauses on `manual_assets`. FDs, gold and property sit at no broker, so a broker filter
 * leaves them out; the market follows the asset's currency.
 */
export function manualScopeClauses(userId: string, arg: ScopeArg): SQL[] {
  const scope = toScope(arg);
  const clauses: SQL[] = [eq(manualAssets.userId, userId)];
  if (scope.portfolioIds?.length) clauses.push(inArray(manualAssets.portfolioId, scope.portfolioIds));
  if (scope.brokers?.length) clauses.push(eq(manualAssets.id, "__none__"));
  if (scope.market === "in") clauses.push(eq(manualAssets.currency, "INR"));
  if (scope.market === "us") clauses.push(ne(manualAssets.currency, "INR"));
  return clauses;
}

/** A stable key for caches. */
export function scopeKey(arg: ScopeArg): string {
  const s = toScope(arg);
  return [(s.portfolioIds ?? []).slice().sort().join(","), (s.brokers ?? []).slice().sort().join(","), s.market ?? ""].join("|");
}

/**
 * The single stored-history bucket this scope maps to — one person, or everyone — or `false` when
 * it's a custom slice (several people, a broker, a market) that has no stored daily snapshots.
 */
export function snapshotScope(arg: ScopeArg): string | null | false {
  const s = toScope(arg);
  if (s.brokers?.length || s.market) return false;
  if (!s.portfolioIds?.length) return null;
  return s.portfolioIds.length === 1 ? s.portfolioIds[0]! : false;
}

/** Is anything filtered at all? */
export const isFiltered = (arg: ScopeArg): boolean => {
  const s = toScope(arg);
  return !!(s.portfolioIds?.length || s.brokers?.length || s.market);
};
