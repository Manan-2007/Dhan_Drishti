import { and, eq, inArray, notInArray } from "drizzle-orm";
import { valueTimeline, type CanonicalTx } from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { quotes, securities, transactions } from "../db/schema.js";
import { txScopeClauses, type ScopeArg } from "./scope.js";
import { baseCurrencyOf, rateMap } from "../market/fx.js";
import { asOf, fillFx, fillHistory, hasHistory, loadFx, loadHistory, missingHistory, type HistorySources } from "../market/history-store.js";

/**
 * Your investments' value on every trading day since the first trade, with what had gone into
 * them — the line a stock app draws, rebuilt from the ledger and cached public closes rather than
 * waiting for daily snapshots to pile up. F&O contracts are left out: they have no public daily
 * prices to value them by. Series still being fetched are counted at cost meanwhile, and the
 * response says so (`pending`), so the chart fills in as they arrive.
 */

export const RANGE_DAYS: Record<string, number | null> = { "1m": 31, "3m": 92, "6m": 183, "1y": 366, "3y": 1096, max: null };

const day = (iso: string) => iso.slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${day(iso)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Weekdays from `from` to `to` inclusive — the trading calendar, near enough (holidays read flat). */
function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d);
  }
  if (out[out.length - 1] !== to) out.push(to); // always end on today
  return out;
}

const inFlight = new Set<string>();

/** Start fetching missing series in the background (at most one run per user at a time). */
export function fillLater(db: DB, userId: string, ids: string[], from: string, currencies: string[], sources: HistorySources): void {
  if (inFlight.has(userId)) return;
  inFlight.add(userId);
  void (async () => {
    try {
      const base = await baseCurrencyOf(db, userId);
      if (sources.fx) await fillFx(db, currencies, base, from, sources.fx);
      await fillHistory(db, ids, from, sources);
    } catch {
      /* retried on the next request */
    } finally {
      inFlight.delete(userId);
    }
  })();
}

export async function computeValueHistory(db: DB, userId: string, scope: ScopeArg, range: string, sources?: HistorySources) {
  const clauses = [...(await txScopeClauses(db, userId, scope)), notInArray(transactions.segment, ["fno", "commodity"])];
  const txs = (await db.select().from(transactions).where(and(...clauses)).all()) as unknown as CanonicalTx[];
  const held = txs.filter((t) => t.securityId);
  const base = await baseCurrencyOf(db, userId);
  if (held.length === 0) return { available: false as const, reason: "No investments yet.", baseCurrency: base };

  const today = day(new Date().toISOString());
  const first = held.map((t) => day(t.tradeDate)).sort()[0]!;
  const span = RANGE_DAYS[range] ?? null;
  const from = span === null || addDays(today, -span) < first ? first : addDays(today, -span);

  const ids = [...new Set(held.map((t) => t.securityId!))];
  const secs = await db.select().from(securities).where(inArray(securities.id, ids)).all();
  const withSeries = secs.filter(hasHistory).map((s) => s.id);
  const currencies = [...new Set(secs.map((s) => s.currency))];
  const missing = await missingHistory(db, withSeries, first);
  if (missing.length && sources) fillLater(db, userId, missing, first, currencies, sources);

  const [bars, fxBars, latestFx, latestQuotes] = await Promise.all([
    loadHistory(db, withSeries, addDays(from, -10)),
    loadFx(db, currencies, base, from),
    rateMap(db, currencies.filter((c) => c !== base), base),
    db.select().from(quotes).where(inArray(quotes.securityId, ids)).all(),
  ]);
  const quoteOf = new Map(latestQuotes.map((q) => [q.securityId, Number(q.price)]));

  const points = valueTimeline(
    held,
    weekdays(from, today),
    // Today is valued at the live quote the rest of the app uses; earlier days at that day's close.
    (sid, date) => (date === today && quoteOf.has(sid) ? quoteOf.get(sid)! : asOf(bars.get(sid), date)),
    (c, date) => (c === base ? 1 : (asOf(fxBars.get(c), date) ?? (latestFx.get(c) ? Number(latestFx.get(c)) : null))),
  );

  const last = points[points.length - 1]!;
  return {
    available: true as const,
    baseCurrency: base,
    from,
    to: today,
    /** Series still being fetched; the chart fills in as they arrive. */
    pending: missing.length,
    /** Share of today's value counted at cost for want of a price. */
    atCostShare: last.value > 0 ? last.atCost / last.value : 0,
    points: points.map((p) => ({ date: p.date, value: Math.round(p.value * 100) / 100, invested: Math.round(p.invested * 100) / 100 })),
  };
}
