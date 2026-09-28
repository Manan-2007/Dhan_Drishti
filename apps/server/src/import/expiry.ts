import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import { d, ZERO } from "@dhan-drishti/core";
import type { DB, Database } from "../db/index.js";
import { securities, settlementPrices, transactions } from "../db/schema.js";
import { monthlyExpiryDay, parseDerivativeSymbol, underlyingYahooSymbol, type ParsedDerivative } from "../market/derivative-symbol.js";
import type { BenchmarkProvider } from "../market/types.js";
import { invalidateAllHoldings } from "../domain/holdings-cache.js";
import { rowHash } from "./csv.js";

/**
 * Expired F&O contracts that the files never close.
 *
 * Broker trade files list trades; a contract held to expiry is settled by the exchange and never
 * appears as one. Left alone it stays "open" forever — no value, no profit, and it blocks the
 * yearly growth rate. So each expired contract still open gets a settlement row at the exchange's
 * price: the underlying's close on expiry day for a future, the intrinsic value (what it was worth
 * in the money, else zero) for an option. Settling a long is a sale, a short a buy-back.
 *
 * These rows are derived (`source_broker = 'expiry'`): re-derived whenever trades change, so a
 * real closing trade that arrives later — a newer tradebook, a P&L-report fill — always wins.
 * Prices come from public daily index/stock closes, cached in `settlement_prices`; only the market
 * symbol and a date range ever leave the machine. MCX commodity contracts have no public source
 * here, so they're left open and counted.
 */

export const EXPIRY_SOURCE = "expiry";

interface Key {
  symbol: string;
  nominal: string;
}
const keyOf = (k: Key) => `${k.symbol}|${k.nominal}`;

/** The market symbol whose close settles a contract, or null when there's no public source. */
function settlementSymbol(p: ParsedDerivative, segment: string): string | null {
  if (segment === "commodity") return null;
  return underlyingYahooSymbol(p.underlying);
}

const nominalExpiry = (p: ParsedDerivative) => (p.expiryApprox ? monthlyExpiryDay(p.expiryISO) : p.expiryISO);

export interface SettleResult {
  settled: number;
  /** Prices still to fetch before these contracts can settle. */
  missing: Key[];
  /** Expired and open, but with no public price source (MCX). */
  unpriceable: number;
}

/** Re-derive every settlement row for a user from cached prices. Offline; safe inside a transaction. */
export async function resettleExpired(trx: Database, userId: string, today = new Date().toISOString().slice(0, 10)): Promise<SettleResult> {
  await trx.delete(transactions).where(and(eq(transactions.userId, userId), eq(transactions.sourceBroker, EXPIRY_SOURCE))).run();

  const rows = await trx
    .select({ tx: transactions, symbol: securities.symbol, name: securities.name })
    .from(transactions)
    .innerJoin(securities, eq(transactions.securityId, securities.id))
    .where(and(eq(transactions.userId, userId), inArray(transactions.type, ["buy", "sell", "transfer_in", "transfer_out"]), ne(transactions.segment, "equity"), ne(transactions.segment, "mf")))
    .all();

  // Net quantity per (account or portfolio, contract).
  const open = new Map<string, { net: ReturnType<typeof d>; tx: (typeof rows)[number]["tx"]; parsed: ParsedDerivative; last: string }>();
  for (const r of rows) {
    const parsed = parseDerivativeSymbol(r.symbol, r.name);
    if (!parsed) continue;
    const k = `${r.tx.portfolioId}|${r.tx.accountId ?? ""}|${r.tx.securityId}`;
    const e = open.get(k) ?? { net: ZERO, tx: r.tx, parsed, last: "" };
    const q = d(r.tx.quantity);
    e.net = r.tx.type === "buy" || r.tx.type === "transfer_in" ? e.net.plus(q) : e.net.minus(q);
    if (r.tx.tradeDate > e.last) e.last = r.tx.tradeDate;
    open.set(k, e);
  }

  const expired = [...open.values()].filter((e) => !e.net.isZero() && nominalExpiry(e.parsed) < today);
  if (expired.length === 0) return { settled: 0, missing: [], unpriceable: 0 };

  const cached = new Map((await trx.select().from(settlementPrices).all()).map((p) => [`${p.symbol}|${p.nominalExpiry}`, p]));
  const inserts: (typeof transactions.$inferInsert)[] = [];
  const missing = new Map<string, Key>();
  let unpriceable = 0;
  for (const e of expired) {
    const symbol = settlementSymbol(e.parsed, e.tx.segment);
    if (!symbol) {
      unpriceable++;
      continue;
    }
    const key = { symbol, nominal: nominalExpiry(e.parsed) };
    const price = cached.get(keyOf(key));
    if (!price) {
      missing.set(keyOf(key), key);
      continue;
    }
    if (!price.close || !price.tradingDay) {
      unpriceable++;
      continue;
    }
    const close = d(price.close);
    const value =
      e.parsed.kind === "future"
        ? close
        : e.parsed.optionType === "CE"
          ? atLeastZero(close.minus(e.parsed.strike))
          : atLeastZero(d(e.parsed.strike).minus(close));
    const long = e.net.gt(0);
    const qty = e.net.abs();
    // After the day's trading closes (15:30 IST), and never before the contract's last trade.
    let when = `${price.tradingDay}T10:00:00.000Z`;
    if (when <= e.last) when = new Date(Date.parse(e.last) + 1000).toISOString();
    const what = e.parsed.kind === "future" ? "this future settled at that price" : value.isZero() ? "this option expired worthless" : `this option was worth ${value.toFixed(2)}`;
    inserts.push({
      id: randomUUID(),
      userId,
      portfolioId: e.tx.portfolioId,
      accountId: e.tx.accountId,
      securityId: e.tx.securityId,
      type: long ? "sell" : "buy",
      tradeDate: when,
      quantity: qty.toFixed(),
      price: value.toFixed(),
      grossAmount: qty.times(value).toFixed(),
      currency: e.tx.currency,
      segment: e.tx.segment,
      sourceBroker: EXPIRY_SOURCE,
      rawRowHash: rowHash(EXPIRY_SOURCE, `${e.tx.portfolioId}|${e.tx.accountId ?? ""}|${e.tx.securityId}`),
      notes: `Settled at expiry: ${e.parsed.underlying} closed at ${close.toFixed(2)} on ${price.tradingDay}, so ${what}. Estimated — your files have no closing trade for it; a newer tradebook replaces this.`,
    });
  }
  for (let i = 0; i < inserts.length; i += 100) await trx.insert(transactions).values(inserts.slice(i, i + 100)).run();
  return { settled: inserts.length, missing: [...missing.values()], unpriceable };
}

function atLeastZero(x: ReturnType<typeof d>) {
  return x.gt(0) ? x : ZERO;
}

/** Look up the closes still missing: the last trading day on or before each nominal expiry. */
export async function fetchSettlementPrices(db: DB, provider: BenchmarkProvider, keys: Key[]): Promise<number> {
  let found = 0;
  for (const k of keys) {
    const from = new Date(Date.parse(`${k.nominal}T00:00:00Z`) - 10 * 86_400_000).toISOString().slice(0, 10);
    let bars: { date: string; close: number }[] = [];
    try {
      bars = await provider.getHistory(k.symbol, from, k.nominal);
    } catch {
      bars = [];
    }
    const bar = [...bars].reverse().find((b) => b.date <= k.nominal);
    if (bar) found++;
    await db
      .insert(settlementPrices)
      .values({ symbol: k.symbol, nominalExpiry: k.nominal, tradingDay: bar?.date ?? null, close: bar ? String(bar.close) : null, fetchedAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: [settlementPrices.symbol, settlementPrices.nominalExpiry], set: { tradingDay: bar?.date ?? null, close: bar ? String(bar.close) : null, fetchedAt: new Date().toISOString() } })
      .run();
  }
  return found;
}

/** Settle what can be settled now, fetch what's missing, then settle again. For the scheduler and after imports. */
export async function refreshExpirySettlements(db: DB, userId: string, provider: BenchmarkProvider): Promise<SettleResult> {
  // A lookup that found nothing is retried after a day (the provider may have been down).
  const stale = new Date(Date.now() - 86_400_000).toISOString();
  const failed = await db.select().from(settlementPrices).all();
  const retry = failed.filter((p) => !p.close && p.fetchedAt < stale).map((p) => ({ symbol: p.symbol, nominal: p.nominalExpiry }));
  if (retry.length) await fetchSettlementPrices(db, provider, retry);

  let result = await db.transaction((trx) => resettleExpired(trx, userId));
  if (result.missing.length) {
    await fetchSettlementPrices(db, provider, result.missing);
    result = await db.transaction((trx) => resettleExpired(trx, userId));
  }
  invalidateAllHoldings();
  return result;
}
