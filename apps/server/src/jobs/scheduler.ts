import { randomUUID } from "node:crypto";
import { inArray, isNotNull } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { transactions, securities, quotes } from "../db/schema.js";
import type { BenchmarkProvider, FxProvider, MarketDataProvider } from "../market/types.js";
import { refreshExpirySettlements } from "../import/expiry.js";
import { topUpHistory, type HistorySources } from "../market/history-store.js";
import { backfillFxAtCost, refreshRates } from "../market/fx.js";
import { writeAllScopes } from "../domain/snapshots.js";
import { pruneQuotesToLatest } from "../market/service.js";
import { invalidateAllHoldings } from "../domain/holdings-cache.js";
import { deleteExpiredSessions } from "../auth/service.js";
import { fillAllMissingSplits, type SplitSources } from "../market/splits.js";

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

/**
 * Keep foreign-currency figures right without anyone pressing a button: today's rate for every
 * currency held, and the trade-date rate (FX-at-cost) on any foreign trade that lacks one. Only
 * currency codes and dates are sent to the rate provider — never amounts or holdings.
 */
export async function refreshAllFx(db: DB, fx: FxProvider): Promise<void> {
  // Everyone with a ledger: which currencies are "foreign" depends on each user's base currency,
  // and a user with none makes no requests.
  const users = await db.selectDistinct({ userId: transactions.userId }).from(transactions).all();
  for (const u of users) {
    try {
      await refreshRates(db, u.userId, fx);
      await backfillFxAtCost(db, u.userId, fx);
    } catch {
      /* rates are best effort; the next pass retries */
    }
  }
  if (users.length) invalidateAllHoldings();
}

/** Settle F&O contracts that expired since the last pass (see import/expiry.ts). */
export async function settleAllExpiries(db: DB, index: BenchmarkProvider): Promise<void> {
  const users = await db.selectDistinct({ userId: transactions.userId }).from(transactions).all();
  for (const u of users) {
    try {
      await refreshExpirySettlements(db, u.userId, index);
    } catch {
      /* best effort; the next pass retries */
    }
  }
}

export interface MaintenanceProviders {
  /** Public stock splits, to fill in ones the files miss. */
  splits?: SplitSources;
  fx?: FxProvider;
  index?: BenchmarkProvider;
  /** Keeps cached price history current for the charts. */
  history?: HistorySources;
}

/** One maintenance pass: refresh prices (also prunes quotes + drops the holdings cache) and
 *  exchange rates, settle expired contracts, record the day's snapshots, and sweep expired sessions. */
export async function runMaintenance(db: DB, provider: MarketDataProvider, extra: MaintenanceProviders = {}): Promise<void> {
  await refreshAllHeldQuotes(db, provider);
  if (extra.fx) await refreshAllFx(db, extra.fx);
  if (extra.index) await settleAllExpiries(db, extra.index);
  if (extra.history) await topUpHistory(db, extra.history).catch(() => undefined);
  if (extra.splits) await fillAllMissingSplits(db, extra.splits).catch(() => undefined);
  await snapshotAllUsers(db);
  await deleteExpiredSessions(db).catch(() => undefined);
}

/**
 * Start the background scheduler: an initial pass shortly after boot, then every `intervalHours`.
 * Returns a stop function. Not started inside buildApp so tests never spin timers.
 */
export function startScheduler(db: DB, provider: MarketDataProvider, extra: MaintenanceProviders = {}, intervalHours = 6): () => void {
  const tick = () => {
    runMaintenance(db, provider, extra).catch((err) => {
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
