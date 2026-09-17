import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { d, type Decimal } from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { exchangeRates, transactions, securities, users } from "../db/schema.js";
import type { FxProvider } from "./types.js";

/** Latest stored rate to convert `from` → `to` (units of `to` per 1 `from`). 1 when equal. */
export async function getRate(db: DB, from: string, to: string): Promise<Decimal | null> {
  if (from === to) return d("1");
  const row = await db
    .select()
    .from(exchangeRates)
    .where(and(eq(exchangeRates.baseCurrency, from), eq(exchangeRates.quoteCurrency, to)))
    .orderBy(desc(exchangeRates.asOf))
    .get();
  return row ? d(row.rate) : null;
}

/** Rate map converting each given currency → base (base itself maps to 1). */
export async function rateMap(db: DB, currencies: string[], base: string): Promise<Map<string, Decimal | null>> {
  const map = new Map<string, Decimal | null>();
  for (const c of new Set(currencies)) map.set(c, await getRate(db, c, base));
  return map;
}

async function baseCurrencyOf(db: DB, userId: string): Promise<string> {
  const u = await db.select({ baseCurrency: users.baseCurrency }).from(users).where(eq(users.id, userId)).get();
  return u?.baseCurrency ?? "INR";
}

/** Currencies of the securities a user actually holds (excluding their base currency). */
async function heldCurrencies(db: DB, userId: string, base: string): Promise<string[]> {
  const secIdRows = await db
    .selectDistinct({ securityId: transactions.securityId })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .all();
  const ids = secIdRows.map((r) => r.securityId).filter((x): x is string => !!x);
  if (ids.length === 0) return [];
  const secs = await db.select({ currency: securities.currency }).from(securities).where(inArray(securities.id, ids)).all();
  return [...new Set(secs.map((s) => s.currency).filter((c) => c && c !== base))];
}

export interface FxRefreshResult {
  base: string;
  requested: number;
  updated: number;
  failed: number;
}

export async function refreshRates(db: DB, userId: string, provider: FxProvider): Promise<FxRefreshResult> {
  const base = await baseCurrencyOf(db, userId);
  const currencies = await heldCurrencies(db, userId, base);
  let updated = 0;
  for (const from of currencies) {
    const rate = await provider.getRate(from, base);
    if (!rate) continue;
    await db
      .insert(exchangeRates)
      .values({ id: randomUUID(), baseCurrency: from, quoteCurrency: base, rate, asOf: new Date().toISOString(), provider: provider.id })
      .run();
    updated += 1;
  }
  return { base, requested: currencies.length, updated, failed: currencies.length - updated };
}

/**
 * Historical FX-at-cost for a foreign-currency trade: the rate on its trade date, so returns
 * can later be split into asset vs currency components. Best-effort — null on any failure.
 */
export async function fxAtCost(
  provider: FxProvider,
  from: string,
  base: string,
  tradeDateISO: string,
): Promise<string | null> {
  if (from === base) return "1";
  if (!provider.getRateOn) return null;
  try {
    return await provider.getRateOn(from, base, tradeDateISO);
  } catch {
    return null;
  }
}

/**
 * Backfill `fxRateToBase` on the user's foreign-currency transactions that lack it, using the
 * provider's historical rates. Idempotent — only fills nulls. Returns how many were updated.
 */
export async function backfillFxAtCost(db: DB, userId: string, provider: FxProvider): Promise<{ scanned: number; updated: number }> {
  const base = await baseCurrencyOf(db, userId);
  const rows = await db
    .select({ id: transactions.id, currency: transactions.currency, tradeDate: transactions.tradeDate, fx: transactions.fxRateToBase })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .all();
  let updated = 0;
  const cache = new Map<string, string | null>();
  for (const row of rows) {
    if (row.currency === base || (row.fx != null && row.fx !== "")) continue;
    const key = `${row.currency}|${row.tradeDate.slice(0, 10)}`;
    let rate = cache.get(key);
    if (rate === undefined) {
      rate = await fxAtCost(provider, row.currency, base, row.tradeDate);
      cache.set(key, rate);
    }
    if (rate == null) continue;
    await db.update(transactions).set({ fxRateToBase: rate }).where(eq(transactions.id, row.id)).run();
    updated += 1;
  }
  return { scanned: rows.length, updated };
}

/** Insert/refresh a manual rate (from → to). */
export async function setRate(db: DB, from: string, to: string, rate: string): Promise<void> {
  await db
    .insert(exchangeRates)
    .values({ id: randomUUID(), baseCurrency: from, quoteCurrency: to, rate, asOf: new Date().toISOString(), provider: "manual" })
    .run();
}

export { baseCurrencyOf };
