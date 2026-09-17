import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { transactions, securities, quotes } from "../db/schema.js";
import { getPortfolioOwned } from "../domain/portfolios.js";
import type { MarketDataProvider, SecurityLike } from "./types.js";

export interface RefreshResult {
  requested: number;
  updated: number;
  failed: number;
  provider: string;
  asOf: string | null;
}

/** Securities the user currently transacts in (optionally scoped to one portfolio). */
async function heldSecurities(db: DB, userId: string, portfolioId?: string): Promise<SecurityLike[]> {
  const clauses = [eq(transactions.userId, userId)];
  if (portfolioId) clauses.push(eq(transactions.portfolioId, portfolioId));
  const rows = await db
    .selectDistinct({ securityId: transactions.securityId })
    .from(transactions)
    .where(and(...clauses))
    .all();
  const ids = rows.map((r) => r.securityId).filter((x): x is string => !!x);
  if (ids.length === 0) return [];
  const secs = await db.select().from(securities).where(inArray(securities.id, ids)).all();
  return secs.map((s) => ({
    id: s.id,
    symbol: s.symbol,
    isin: s.isin,
    amfiCode: s.amfiCode,
    assetClass: s.assetClass,
    exchange: s.exchange,
    currency: s.currency,
  }));
}

export async function refreshQuotes(
  db: DB,
  userId: string,
  provider: MarketDataProvider,
  portfolioId?: string,
): Promise<RefreshResult> {
  if (portfolioId) await getPortfolioOwned(db, userId, portfolioId);
  const secs = await heldSecurities(db, userId, portfolioId);
  if (secs.length === 0) {
    return { requested: 0, updated: 0, failed: 0, provider: provider.id, asOf: null };
  }
  const results = await provider.getQuotes(secs);
  let updated = 0;
  let latest: string | null = null;
  for (const q of results) {
    await db
      .insert(quotes)
      .values({
        id: randomUUID(),
        securityId: q.securityId,
        price: q.price,
        prevClose: q.prevClose ?? null,
        currency: q.currency,
        asOf: q.asOf,
        provider: q.provider,
      })
      .run();
    updated += 1;
    if (!latest || q.asOf > latest) latest = q.asOf;
  }
  return { requested: secs.length, updated, failed: secs.length - updated, provider: provider.id, asOf: latest };
}

/** Timestamp of the most recent quote across the user's held securities. */
export async function lastQuoteAsOf(db: DB, userId: string, portfolioId?: string): Promise<string | null> {
  const secs = await heldSecurities(db, userId, portfolioId);
  if (secs.length === 0) return null;
  const rows = await db
    .select({ asOf: quotes.asOf })
    .from(quotes)
    .where(inArray(quotes.securityId, secs.map((s) => s.id)))
    .all();
  let latest: string | null = null;
  for (const r of rows) if (!latest || r.asOf > latest) latest = r.asOf;
  return latest;
}
