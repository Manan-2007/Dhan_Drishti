import { and, eq, gte, inArray } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { fxHistory, priceHistory, priceHistoryStatus, securities, type Security } from "../db/schema.js";
import { parseDerivativeSymbol } from "./derivative-symbol.js";
import type { BenchmarkBar, SecurityHistoryProvider } from "./types.js";
import type { AmfiProvider } from "./providers/amfi.js";
import type { MfApiHistoryProvider } from "./providers/mfapi.js";
import type { FrankfurterProvider } from "./providers/frankfurter.js";

/**
 * A local cache of public daily closes (and fund NAVs, and exchange rates), so every chart and the
 * value-over-time line draw offline and instantly. A series is fetched once from where it starts
 * being needed, then only topped up with the days since. Only public identifiers leave the
 * machine: a ticker, a fund's scheme code, a currency pair, and dates.
 */

export interface HistorySources {
  shares: SecurityHistoryProvider;
  funds?: { amfi: AmfiProvider; nav: MfApiHistoryProvider };
  fx?: FrankfurterProvider;
}

const today = () => new Date().toISOString().slice(0, 10);
const dayAfter = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const FRESH_MS = 12 * 3600 * 1000;

/** Securities with a public daily series: listed shares, ETFs, trusts, bonds, funds — never F&O. */
export function hasHistory(s: Security): boolean {
  if (s.assetClass === "cash" || s.assetClass === "other") return false;
  return !parseDerivativeSymbol(s.symbol, s.name);
}

/** Is this security's cached series complete from `from` up to yesterday (or known to not exist)? */
function covered(status: typeof priceHistoryStatus.$inferSelect | undefined, from: string): boolean {
  if (!status) return false;
  if (!status.source) return Date.now() - Date.parse(status.fetchedAt) < 7 * 86_400_000; // none found; retry weekly
  const fresh = Date.now() - Date.parse(status.fetchedAt) < FRESH_MS;
  return !!status.firstDate && status.firstDate <= from && fresh;
}

export async function missingHistory(db: DB, ids: string[], from: string): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(priceHistoryStatus).where(inArray(priceHistoryStatus.securityId, ids)).all();
  const byId = new Map(rows.map((r) => [r.securityId, r]));
  return ids.filter((id) => !covered(byId.get(id), from));
}

async function fetchOne(db: DB, sec: Security, from: string, sources: HistorySources): Promise<void> {
  const [status] = await db.select().from(priceHistoryStatus).where(eq(priceHistoryStatus.securityId, sec.id)).all();
  // Top up from the last day we have, unless we need to reach further back than we've fetched.
  const start = status?.firstDate && status.firstDate <= from && status.lastDate ? dayAfter(status.lastDate) : from;
  const end = today();
  let bars: BenchmarkBar[] = [];
  let source: string | null = null;
  if (start <= end) {
    if (sec.assetClass === "mf") {
      let code = sec.amfiCode;
      if (!code && sec.isin && sources.funds) {
        code = await sources.funds.amfi.codeForIsin(sec.isin);
        if (code) await db.update(securities).set({ amfiCode: code }).where(eq(securities.id, sec.id)).run();
      }
      if (code && sources.funds) {
        bars = await sources.funds.nav.getHistory(code, start, end);
        source = "mfapi";
      }
    } else {
      bars = await sources.shares.getHistory({ id: sec.id, symbol: sec.symbol, isin: sec.isin, amfiCode: sec.amfiCode, assetClass: sec.assetClass, exchange: sec.exchange, currency: sec.currency }, start, end);
      source = sources.shares.id;
    }
  }
  for (let i = 0; i < bars.length; i += 200) {
    await db
      .insert(priceHistory)
      .values(bars.slice(i, i + 200).map((b) => ({ securityId: sec.id, date: b.date, close: String(b.close) })))
      .onConflictDoUpdate({ target: [priceHistory.securityId, priceHistory.date], set: { close: priceHistory.close } })
      .run();
  }
  const last = bars[bars.length - 1]?.date ?? null;
  const known = bars.length > 0 || !!status?.source;
  // A series we have (or just found) covers from the earliest day asked for; none found → retried later.
  const row = known
    ? {
        securityId: sec.id,
        source: source ?? status?.source ?? null,
        firstDate: [status?.firstDate, from].filter((x): x is string => !!x).sort()[0]!,
        lastDate: [status?.lastDate, last].filter((x): x is string => !!x).sort().pop() ?? null,
        fetchedAt: new Date().toISOString(),
      }
    : { securityId: sec.id, source: null, firstDate: null, lastDate: null, fetchedAt: new Date().toISOString() };
  await db.insert(priceHistoryStatus).values(row).onConflictDoUpdate({ target: priceHistoryStatus.securityId, set: row }).run();
}

/** Fetch whatever is missing for these securities, a few at a time. */
export async function fillHistory(db: DB, ids: string[], from: string, sources: HistorySources): Promise<number> {
  const need = await missingHistory(db, ids, from);
  if (need.length === 0) return 0;
  const secs = await db.select().from(securities).where(inArray(securities.id, need)).all();
  let next = 0;
  const worker = async () => {
    while (next < secs.length) {
      const s = secs[next++]!;
      try {
        await fetchOne(db, s, from, sources);
      } catch {
        /* one series failing never stops the rest */
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return need.length;
}

/** Daily closes per security from `from`, oldest first. */
export async function loadHistory(db: DB, ids: string[], from: string): Promise<Map<string, BenchmarkBar[]>> {
  const out = new Map<string, BenchmarkBar[]>();
  if (ids.length === 0) return out;
  const rows = await db
    .select()
    .from(priceHistory)
    .where(and(inArray(priceHistory.securityId, ids), gte(priceHistory.date, from)))
    .orderBy(priceHistory.date)
    .all();
  for (const r of rows) {
    const list = out.get(r.securityId) ?? [];
    list.push({ date: r.date, close: Number(r.close) });
    out.set(r.securityId, list);
  }
  return out;
}

/** Daily base-currency rates for foreign currencies, fetched once per range and cached. */
export async function fillFx(db: DB, currencies: string[], base: string, from: string, fx: FrankfurterProvider): Promise<void> {
  for (const c of currencies) {
    if (c === base) continue;
    const have = await db.select({ date: fxHistory.date }).from(fxHistory).where(and(eq(fxHistory.currency, c), eq(fxHistory.base, base))).orderBy(fxHistory.date).all();
    const first = have[0]?.date;
    const last = have[have.length - 1]?.date;
    const ranges: [string, string][] = [];
    if (!first || first > from) ranges.push([from, first ?? today()]);
    if (last && last < today()) ranges.push([dayAfter(last), today()]);
    for (const [a, b] of ranges) {
      const series = await fx.getSeries(c, base, a, b);
      const rows = [...series].map(([date, rate]) => ({ currency: c, base, date, rate: String(rate) }));
      for (let i = 0; i < rows.length; i += 200) await db.insert(fxHistory).values(rows.slice(i, i + 200)).onConflictDoNothing().run();
    }
  }
}

export async function loadFx(db: DB, currencies: string[], base: string, from: string): Promise<Map<string, BenchmarkBar[]>> {
  const out = new Map<string, BenchmarkBar[]>();
  for (const c of currencies) {
    if (c === base) continue;
    // A few days before `from`, so the first day has the rate in force.
    const since = new Date(Date.parse(`${from}T00:00:00Z`) - 10 * 86_400_000).toISOString().slice(0, 10);
    const rows = await db.select().from(fxHistory).where(and(eq(fxHistory.currency, c), eq(fxHistory.base, base), gte(fxHistory.date, since))).orderBy(fxHistory.date).all();
    out.set(c, rows.map((r) => ({ date: r.date, close: Number(r.rate) })));
  }
  return out;
}

/** The last value on or before `date` in an ascending series (binary search). */
export function asOf(series: BenchmarkBar[] | undefined, date: string): number | null {
  if (!series || series.length === 0 || series[0]!.date > date) return null;
  let lo = 0;
  let hi = series.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (series[mid]!.date <= date) lo = mid;
    else hi = mid - 1;
  }
  return series[lo]!.close;
}

/** Scheduler: bring every cached series up to date (only the days since each one's last close). */
export async function topUpHistory(db: DB, sources: HistorySources): Promise<void> {
  const stale = new Date(Date.now() - FRESH_MS).toISOString();
  const rows = await db.select().from(priceHistoryStatus).all();
  const due = rows.filter((r) => r.source && r.firstDate && r.fetchedAt < stale);
  const secs = new Map((due.length ? await db.select().from(securities).where(inArray(securities.id, due.map((r) => r.securityId))).all() : []).map((s) => [s.id, s]));
  for (const r of due) {
    const sec = secs.get(r.securityId);
    if (!sec) continue;
    try {
      await fetchOne(db, sec, r.firstDate!, sources);
    } catch {
      /* next pass */
    }
  }
}
