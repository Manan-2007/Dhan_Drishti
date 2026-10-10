import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, lte, desc } from "drizzle-orm";
import { computeHoldings, d, type CanonicalTx } from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { priceHistory, securities, splitChecks, splitEvents, splitReviews, transactions, type Security } from "../db/schema.js";
import { rowHash } from "../import/csv.js";
import { SNAPSHOT_SOURCE, refreshSnapshots, type Scope } from "../import/snapshot.js";
import { bumpHoldings } from "../domain/holdings-cache.js";
import { parseDerivativeSymbol } from "./derivative-symbol.js";
import type { SecurityHistoryProvider, SplitSource } from "./types.js";

/**
 * Stock splits the broker's files leave out, filled in from public market data.
 *
 * Exports often record trades in the shares of their day and never mention a split since (Vested
 * has no row for Netflix's 10-for-1 in Nov 2025), so the share count and average price stop
 * matching the broker. For each split public data lists for a stock you held, each account's own
 * prices decide it: public daily closes are split-adjusted, so a trade before the split priced at
 * ~ratio × that day's close is in old shares (the split is missing: add it); at ~1× the broker has
 * already restated it (leave it). Anything else isn't confirmed and is only reported. A split the
 * user deletes is remembered and never re-added.
 */

export const SPLIT_SOURCE = "public-split";
const SPLITTABLE = new Set(["equity", "etf", "reit_invit"]);
const RECHECK_MS = 24 * 3600 * 1000;
const NEAR = 0.25; // how close a price ratio must be to call it

export interface SplitSources {
  splits: SplitSource;
  /** Daily closes, when the local cache doesn't have the day a check needs. */
  history?: SecurityHistoryProvider;
}

export interface SplitFillResult {
  checked: number;
  added: { securityId: string; symbol: string; exDate: string; label: string }[];
  unconfirmed: number;
}

const day = (iso: string) => iso.slice(0, 10);
const shiftDays = (iso: string, n: number) => new Date(Date.parse(`${day(iso)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const longDate = (iso: string) => new Date(`${day(iso)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const splittable = (s: Security) => SPLITTABLE.has(s.assetClass) && !parseDerivativeSymbol(s.symbol, s.name);
const secLike = (s: Security) => ({ id: s.id, symbol: s.symbol, isin: s.isin, amfiCode: s.amfiCode, assetClass: s.assetClass, exchange: s.exchange, currency: s.currency });

/** The public split list for a security: from the local copy, refreshed at most once a day. */
async function splitsFor(db: DB, sec: Security, source: SplitSource): Promise<{ exDate: string; ratio: string; label: string }[]> {
  const check = await db.select().from(splitChecks).where(eq(splitChecks.securityId, sec.id)).get();
  if (!check || Date.now() - Date.parse(check.checkedAt) >= RECHECK_MS) {
    const found = await source.getSplits(secLike(sec));
    if (found !== null) {
      await db.transaction(async (trx) => {
        for (const s of found)
          await trx
            .insert(splitEvents)
            .values({ securityId: sec.id, exDate: s.exDate, ratio: s.ratio, label: s.label, source: source.id })
            .onConflictDoUpdate({ target: [splitEvents.securityId, splitEvents.exDate], set: { ratio: s.ratio, label: s.label, source: source.id } })
            .run();
        await trx
          .insert(splitChecks)
          .values({ securityId: sec.id, checkedAt: new Date().toISOString() })
          .onConflictDoUpdate({ target: splitChecks.securityId, set: { checkedAt: new Date().toISOString() } })
          .run();
      });
    }
  }
  return db.select({ exDate: splitEvents.exDate, ratio: splitEvents.ratio, label: splitEvents.label }).from(splitEvents).where(eq(splitEvents.securityId, sec.id)).all();
}

/** The split-adjusted public close on a day (or the last trading day before it, within a week). */
async function closeOn(db: DB, sec: Security, date: string, history?: SecurityHistoryProvider): Promise<number | null> {
  const from = shiftDays(date, -7);
  const cached = await db
    .select({ close: priceHistory.close })
    .from(priceHistory)
    .where(and(eq(priceHistory.securityId, sec.id), gte(priceHistory.date, from), lte(priceHistory.date, date)))
    .orderBy(desc(priceHistory.date))
    .limit(1)
    .get();
  if (cached) return Number(cached.close);
  if (!history) return null;
  const bars = await history.getHistory(secLike(sec), from, date).catch(() => []);
  const bar = bars.filter((b) => b.date <= date).at(-1);
  return bar ? bar.close : null;
}

type Verdict = { status: "added" | "in_files" | "unconfirmed"; detail: string };

/** Do this account's own prices say the split is missing from its files? */
async function judge(db: DB, sec: Security, split: { exDate: string; ratio: string; label: string }, before: CanonicalTx[], sources: SplitSources): Promise<Verdict> {
  const ratio = Number(split.ratio);
  const last = [...before].reverse().find((t) => (t.type === "buy" || t.type === "sell") && Number(t.price) > 0);
  if (!last) return { status: "unconfirmed", detail: "No priced trade before the split to check it against." };
  if (ratio > 0.75 && ratio < 1.34) return { status: "unconfirmed", detail: `A ${split.label} split is too small a change to confirm from prices.` };
  const close = await closeOn(db, sec, day(last.tradeDate), sources.history);
  if (close === null || !(close > 0)) return { status: "unconfirmed", detail: `No public price for ${longDate(last.tradeDate)} to check your trade against.` };
  const r = Number(last.price) / close;
  if (Math.abs(r / ratio - 1) <= NEAR)
    return { status: "added", detail: `Your trade on ${longDate(last.tradeDate)} at ${last.price} is in the shares from before the split.` };
  if (Math.abs(r - 1) <= NEAR) return { status: "in_files", detail: "Your broker's figures already count it." };
  return { status: "unconfirmed", detail: `Your trade on ${longDate(last.tradeDate)} at ${last.price} doesn't line up with the public price either side of the split.` };
}

/**
 * Check every stock this user has traded for splits their files miss, and fill them in. Safe to run
 * any time: a split already filled, already in the files, or removed by the user is left alone.
 */
export async function fillMissingSplits(db: DB, userId: string, sources: SplitSources): Promise<SplitFillResult> {
  const ledger = (await db.select().from(transactions).where(eq(transactions.userId, userId)).all()) as unknown as (CanonicalTx & { sourceBroker: string | null })[];
  const own = ledger.filter((t) => t.securityId && t.sourceBroker !== SNAPSHOT_SOURCE);
  const traded = [...new Set(own.filter((t) => t.type === "buy" || t.type === "sell").map((t) => t.securityId!))];
  const secs = traded.length ? (await db.select().from(securities).where(inArray(securities.id, traded)).all()).filter(splittable) : [];
  const reviews = await db.select().from(splitReviews).where(eq(splitReviews.userId, userId)).all();
  const reviewOf = new Map(reviews.map((r) => [`${r.portfolioId}|${r.accountKey}|${r.securityId}|${r.exDate}`, r]));

  const result: SplitFillResult = { checked: 0, added: [], unconfirmed: 0 };
  const rows: (typeof transactions.$inferInsert)[] = [];
  const verdicts: (typeof splitReviews.$inferInsert)[] = [];
  const touched: Scope[] = [];

  for (const sec of secs) {
    const mine = own.filter((t) => t.securityId === sec.id);
    const first = mine.map((t) => t.tradeDate).sort()[0]!;
    const splits = (await splitsFor(db, sec, sources.splits)).filter((s) => s.exDate > day(first));
    result.checked++;
    if (!splits.length) continue;

    // Each account (or the account-less rows of a portfolio) is judged on its own trades.
    const scopes = new Map<string, CanonicalTx[]>();
    for (const t of mine) {
      const k = `${t.portfolioId}|${t.accountId ?? ""}`;
      scopes.set(k, [...(scopes.get(k) ?? []), t]);
    }
    for (const split of splits) {
      const at = `${split.exDate}T00:00:00.000Z`;
      for (const [k, txs] of scopes) {
        const [portfolioId, accountKey] = k.split("|") as [string, string];
        const key = `${portfolioId}|${accountKey}|${sec.id}|${split.exDate}`;
        const review = reviewOf.get(key);
        if (review?.status === "dismissed" || review?.status === "in_files") continue;
        const ours = txs.some((t) => t.type === "split" && t.sourceBroker === SPLIT_SOURCE && day(t.tradeDate) === split.exDate);
        if (ours) continue;
        // The files have it already: a split (or bonus) recorded around that day.
        const recorded = txs.some(
          (t) =>
            t.sourceBroker !== SPLIT_SOURCE &&
            ((t.type === "split" && Math.abs(Date.parse(t.tradeDate) - Date.parse(at)) <= 7 * 86_400_000) ||
              (t.type === "bonus" && Math.abs(Date.parse(t.tradeDate) - Date.parse(at)) <= 15 * 86_400_000)),
        );
        if (recorded) {
          verdicts.push({ userId, portfolioId, accountKey, securityId: sec.id, exDate: split.exDate, status: "in_files", detail: "Recorded in your files." });
          continue;
        }
        const before = txs.filter((t) => t.tradeDate < at);
        const held = computeHoldings(before, {}).find((h) => h.securityId === sec.id)?.netQty;
        if (!held || !held.gt(0)) continue; // nothing held then — later trades are in the new shares anyway

        const v = await judge(db, sec, split, before, sources);
        verdicts.push({ userId, portfolioId, accountKey, securityId: sec.id, exDate: split.exDate, status: v.status, detail: v.detail, updatedAt: new Date().toISOString() });
        if (v.status === "unconfirmed") result.unconfirmed++;
        if (v.status !== "added") continue;
        const after = held.times(split.ratio);
        rows.push({
          id: randomUUID(),
          userId,
          portfolioId,
          accountId: accountKey || null,
          securityId: sec.id,
          type: "split",
          tradeDate: at,
          quantity: "0",
          price: split.ratio,
          grossAmount: "0",
          currency: sec.currency,
          segment: "equity",
          sourceBroker: SPLIT_SOURCE,
          rawRowHash: rowHash(SPLIT_SOURCE, key),
          notes: `${split.label} split on ${longDate(at)}, filled in from public market data — your files don't include it. ${d(held).toFixed()} shares became ${after.toFixed()}. ${v.detail}`,
        });
        touched.push({ userId, portfolioId, accountId: accountKey || null });
        result.added.push({ securityId: sec.id, symbol: sec.symbol, exDate: split.exDate, label: split.label });
      }
    }
  }

  if (rows.length || verdicts.length) {
    await db.transaction(async (trx) => {
      for (const r of rows) await trx.insert(transactions).values(r).run();
      for (const v of verdicts)
        await trx
          .insert(splitReviews)
          .values(v)
          .onConflictDoUpdate({
            target: [splitReviews.userId, splitReviews.portfolioId, splitReviews.accountKey, splitReviews.securityId, splitReviews.exDate],
            set: { status: v.status, detail: v.detail, updatedAt: new Date().toISOString() },
          })
          .run();
      // Holdings statements are reconciled against the trades; the split changes what they explain.
      await refreshSnapshots(trx, touched);
    });
  }
  if (rows.length) bumpHoldings(userId);
  return result;
}

/** The user removed a filled-in split: remember it, so it isn't filled in again. */
export async function dismissSplit(db: DB, tx: { userId: string; portfolioId: string; accountId: string | null; securityId: string | null; tradeDate: string }): Promise<void> {
  if (!tx.securityId) return;
  const row = { userId: tx.userId, portfolioId: tx.portfolioId, accountKey: tx.accountId ?? "", securityId: tx.securityId, exDate: day(tx.tradeDate) };
  await db
    .insert(splitReviews)
    .values({ ...row, status: "dismissed", detail: "Removed by you.", updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: [splitReviews.userId, splitReviews.portfolioId, splitReviews.accountKey, splitReviews.securityId, splitReviews.exDate],
      set: { status: "dismissed", detail: "Removed by you.", updatedAt: new Date().toISOString() },
    })
    .run();
}

/** Run the check for everyone with a ledger (the background pass). */
export async function fillAllMissingSplits(db: DB, sources: SplitSources): Promise<void> {
  const users = await db.selectDistinct({ userId: transactions.userId }).from(transactions).all();
  for (const u of users) await fillMissingSplits(db, u.userId, sources).catch(() => undefined);
}
