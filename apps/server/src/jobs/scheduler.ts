import { randomUUID } from "node:crypto";
import { inArray, isNotNull } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { transactions, securities, quotes } from "../db/schema.js";
import type { MarketDataProvider } from "../market/types.js";
import { writeAllScopes } from "../domain/snapshots.js";
import { pruneQuotesToLatest } from "../market/service.js";
import { invalidateAllHoldings } from "../domain/holdings-cache.js";

/** Refresh quotes for every security anyone holds, in one deduplicated pass (shared master), so a
 *  nightly job keeps prices fresh without the dashboard ever opening stale. */
export async function refreshAllHeldQuotes(db: DB, provider: MarketDataProvider): Promise<{ requested: number; updated: number }> {
  const idRows = await db.selectDistinct({ securityId: transactions.securityId }).from(transactions).where(isNotNull(transactions.securityId)).all();
  const ids = idRows.map((r) => r.securityId).filter((x): x is string => !!x);
  if (ids.length === 0) return { requested: 0, updated: 0 };
  const secs = await db.select().from(securities).where(inArray(securities.id, ids)).all();
  const results = await provider.getQuotes(secs.map((s) => ({ id: s.id, symbol: s.symbol, isin: s.isin, amfiCode: s.amfiCode, assetClass: s.assetClass, exchange: s.exchange, currency: s.currency })));
  let updated = 0;
  for (const q of results) {
    await db.insert(quotes).values({ id: randomUUID(), securityId: q.securityId, price: q.price, prevClose: q.prevClose ?? null, currency: q.currency, asOf: q.asOf, provider: q.provider }).run();
    updated += 1;
  }
  if (updated > 0) {
    await pruneQuotesToLatest(db); // keep one quote per security
    invalidateAllHoldings(); // background prices changed for everyone → drop cached holdings
  }
  return { requested: secs.length, updated };
}

/** Record today's net-worth snapshot for every user (all scopes). */
export async function snapshotAllUsers(db: DB): Promise<number> {
  const userRows = await db.selectDistinct({ userId: transactions.userId }).from(transactions).all();
  for (const u of userRows) {
    try {
      await writeAllScopes(db, u.userId);
    } catch {
      /* one user's snapshot failure shouldn't stop the others */
    }
  }
  return userRows.length;
}

/** One maintenance pass: refresh prices (also prunes quotes + drops the holdings cache), then
 *  record the day's snapshots. */
export async function runMaintenance(db: DB, provider: MarketDataProvider): Promise<void> {
  await refreshAllHeldQuotes(db, provider);
  await snapshotAllUsers(db);
}

/**
 * Start the background scheduler: an initial pass shortly after boot, then every `intervalHours`.
 * Returns a stop function. Not started inside buildApp so tests never spin timers.
 */
export function startScheduler(db: DB, provider: MarketDataProvider, intervalHours = 6): () => void {
  const tick = () => {
    runMaintenance(db, provider).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[scheduler] maintenance failed:", err);
    });
  };
  const initial = setTimeout(tick, 30_000); // let the server settle first
  const timer = setInterval(tick, intervalHours * 60 * 60 * 1000);
  initial.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(initial);
    clearInterval(timer);
  };
}
