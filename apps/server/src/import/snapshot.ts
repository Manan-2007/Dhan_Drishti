import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { computeHoldings, d, ZERO, type CanonicalTx } from "@dhan-drishti/core";
import type { DB, Database } from "../db/index.js";
import type { NormalizedRow } from "./types.js";
import { holdingSnapshots, importBatches, securities, transactions } from "../db/schema.js";
import { rowHash } from "./csv.js";
import { invalidateAllHoldings } from "../domain/holdings-cache.js";

/**
 * Holdings statements, reconciled against the trades instead of added on top of them.
 *
 * A statement says what an account held on one day; the trade files say how it got there, often
 * only partly (a tradebook from April onwards, say). Adding the statement's positions as buys
 * counted every share the trades had already bought twice. Instead the ledger gets only the
 * difference, derived from the account's LATEST statement:
 *   - more held than the trades explain → an opening balance, dated the day before the trade
 *     history starts, at the broker's average price (bought before the files begin);
 *   - fewer → a transfer out on the statement date, at cost, so no profit is invented for a sale
 *     whose price isn't known;
 *   - the same → nothing.
 * These rows are derived: they're deleted and re-derived whenever the account's trades change, so
 * the order files arrive in doesn't matter and nothing is ever counted twice.
 */

export const SNAPSHOT_SOURCE = "snapshot";

/** An account, or — for imports with no account — the portfolio's account-less rows. */
export interface Scope {
  userId: string;
  portfolioId: string;
  accountId: string | null;
}

export interface SnapshotPosition {
  securityId: string;
  quantity: string;
  avgPrice: string;
  currency: string;
}

export interface SnapshotSummary {
  asOf: string;
  /** Positions topped up with an opening balance (bought before the trade history). */
  opening: number;
  /** Positions the statement shows fewer of than the trades add up to. */
  reduced: number;
  /** Shares/funds the trades say are held that the statement doesn't list (sold since, most likely). */
  notInStatement: string[];
}

const txScope = (s: Scope) =>
  and(eq(transactions.userId, s.userId), s.accountId ? eq(transactions.accountId, s.accountId) : and(eq(transactions.portfolioId, s.portfolioId), isNull(transactions.accountId)));
const snapScope = (s: Scope) =>
  and(eq(holdingSnapshots.userId, s.userId), s.accountId ? eq(holdingSnapshots.accountId, s.accountId) : and(eq(holdingSnapshots.portfolioId, s.portfolioId), isNull(holdingSnapshots.accountId)));

const day = (iso: string) => iso.slice(0, 10);
const midnight = (iso: string) => `${day(iso)}T00:00:00.000Z`;
const dayBefore = (iso: string) => {
  const t = new Date(midnight(iso));
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString();
};
const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

async function latestSnapshot(trx: Database, scope: Scope) {
  return trx
    .select({ batchId: holdingSnapshots.importBatchId, asOf: holdingSnapshots.asOf })
    .from(holdingSnapshots)
    .where(snapScope(scope))
    .orderBy(desc(holdingSnapshots.asOf), desc(holdingSnapshots.createdAt))
    .limit(1)
    .get();
}

export async function hasSnapshot(trx: Database, scope: Scope): Promise<boolean> {
  return !!(await latestSnapshot(trx, scope));
}

const positionKey = (p: { securityId: string; quantity: string; avgPrice: string }) => `${p.securityId}|${d(p.quantity).toFixed()}|${d(p.avgPrice).toFixed()}`;

/**
 * Save a statement's positions. Re-importing the same statement stores nothing new — the latest
 * one already says the same — so the history of snapshots only grows when holdings change.
 */
export async function storeSnapshot(trx: Database, scope: Scope, batchId: string, asOf: string, positions: SnapshotPosition[]): Promise<boolean> {
  const latest = await latestSnapshot(trx, scope);
  if (latest) {
    const prev = await trx.select().from(holdingSnapshots).where(eq(holdingSnapshots.importBatchId, latest.batchId)).all();
    const a = new Set(prev.map(positionKey));
    if (prev.length === positions.length && positions.every((p) => a.has(positionKey(p)))) return false;
  }
  if (positions.length === 0) return false;
  await trx
    .insert(holdingSnapshots)
    .values(positions.map((p) => ({ id: randomUUID(), userId: scope.userId, portfolioId: scope.portfolioId, accountId: scope.accountId, importBatchId: batchId, asOf, ...p })))
    .run();
  return true;
}

/** Is this statement the one the scope already has (same instruments, quantities and prices)? */
export async function sameAsLatestSnapshot(db: Database, scope: Scope, rows: NormalizedRow[]): Promise<boolean> {
  const latest = await latestSnapshot(db, scope);
  if (!latest) return false;
  const prev = await db
    .select({ symbol: securities.symbol, isin: securities.isin, quantity: holdingSnapshots.quantity, avgPrice: holdingSnapshots.avgPrice })
    .from(holdingSnapshots)
    .innerJoin(securities, eq(holdingSnapshots.securityId, securities.id))
    .where(eq(holdingSnapshots.importBatchId, latest.batchId))
    .all();
  // Instruments are matched the way the importer resolves them: ISIN first (a fund's ticker in the
  // statement can differ from the one on file), else the symbol.
  const amounts = (p: { quantity: string; avgPrice: string }) => `${d(p.quantity).toFixed()}|${d(p.avgPrice).toFixed()}`;
  const had = new Set(prev.flatMap((p) => [p.isin && `i:${p.isin}|${amounts(p)}`, `s:${p.symbol.toUpperCase()}|${amounts(p)}`].filter(Boolean)));
  const now = new Map<string, { quantity: string; avgPrice: string }>();
  for (const r of rows) {
    if (!r.ok || !r.tx.security) continue;
    const id = r.tx.security.isin ? `i:${r.tx.security.isin}` : `s:${r.tx.security.symbol.toUpperCase()}`;
    const p = now.get(id);
    const q = d(r.tx.quantity);
    if (!p) now.set(id, { quantity: q.toFixed(), avgPrice: d(r.tx.price).toFixed() });
    else {
      const total = d(p.quantity).plus(q);
      now.set(id, { quantity: total.toFixed(), avgPrice: d(p.quantity).times(p.avgPrice).plus(q.times(r.tx.price)).div(total).toFixed() });
    }
  }
  return prev.length === now.size && [...now].every(([id, p]) => had.has(`${id}|${amounts(p)}`));
}

/** Re-derive the scope's opening-balance / adjustment rows from its latest statement. */
export async function reconcileSnapshots(trx: Database, scope: Scope): Promise<SnapshotSummary | null> {
  await trx.delete(transactions).where(and(txScope(scope), eq(transactions.sourceBroker, SNAPSHOT_SOURCE))).run();
  const latest = await latestSnapshot(trx, scope);
  if (!latest) return null;

  const positions = await trx.select().from(holdingSnapshots).where(eq(holdingSnapshots.importBatchId, latest.batchId)).all();
  const ledger = (await trx.select().from(transactions).where(txScope(scope)).all()) as unknown as CanonicalTx[];
  const endOfAsOf = `${day(latest.asOf)}T23:59:59.999Z`;
  const held = new Map(computeHoldings(ledger.filter((t) => t.tradeDate <= endOfAsOf), {}).map((h) => [h.securityId, h]));

  const firstTrade = ledger
    .filter((t) => t.type === "buy" || t.type === "sell")
    .map((t) => t.tradeDate)
    .sort()[0];
  const openingDate = firstTrade && firstTrade <= endOfAsOf ? dayBefore(firstTrade) : midnight(latest.asOf);
  const asOfDate = midnight(latest.asOf);
  const statement = longDate(latest.asOf);

  const secIds = [...new Set([...positions.map((p) => p.securityId), ...held.keys()])];
  const secs = new Map((secIds.length ? await trx.select().from(securities).where(inArray(securities.id, secIds)).all() : []).map((s) => [s.id, s]));
  const segmentOf = (securityId: string) => (secs.get(securityId)?.assetClass === "mf" ? "mf" : "equity");

  // The statement counts shares after every split up to its date; an opening balance dated before
  // the history is split along with the trades, so it's recorded in the shares of its own day.
  const splitFactor = (securityId: string) => {
    const seen = new Set<string>();
    let f = d(1);
    for (const t of ledger) {
      if (t.type !== "split" || t.securityId !== securityId || t.tradeDate <= openingDate || t.tradeDate > endOfAsOf) continue;
      const k = `${day(t.tradeDate)}|${d(t.price).toFixed()}`;
      if (seen.has(k) || !d(t.price).gt(0)) continue;
      seen.add(k);
      f = f.times(t.price);
    }
    return f;
  };

  const rows: (typeof transactions.$inferInsert)[] = [];
  let opening = 0;
  let reduced = 0;
  for (const p of positions) {
    const h = held.get(p.securityId);
    // Against the raw quantity (buys − sells), counting sales of shares bought before the history:
    // the opening balance goes in BEFORE that history, so it's what those sales were made from.
    const net = h ? h.netQty.minus(h.soldWithoutPurchase) : ZERO;
    const delta = d(p.quantity).minus(net);
    if (delta.isZero()) continue;
    const base = {
      id: randomUUID(),
      userId: scope.userId,
      portfolioId: scope.portfolioId,
      accountId: scope.accountId,
      securityId: p.securityId,
      importBatchId: latest.batchId,
      currency: p.currency,
      segment: segmentOf(p.securityId),
      sourceBroker: SNAPSHOT_SOURCE,
    };
    if (delta.gt(0)) {
      opening++;
      const f = splitFactor(p.securityId);
      rows.push({
        ...base,
        type: "buy",
        tradeDate: openingDate,
        quantity: delta.div(f).toFixed(),
        price: d(p.avgPrice).times(f).toFixed(),
        grossAmount: delta.times(p.avgPrice).toFixed(),
        rawRowHash: rowHash(SNAPSHOT_SOURCE, `${latest.batchId}|${p.securityId}|opening`),
        notes: `Opening balance from your holdings statement of ${statement}: held before your trade history starts, at the broker's average price.`,
      });
    } else {
      reduced++;
      // At cost, so the adjustment books no profit or loss.
      const cost = h?.avgCost ?? d(p.avgPrice);
      rows.push({
        ...base,
        type: "transfer_out",
        tradeDate: asOfDate,
        quantity: delta.negated().toFixed(),
        price: cost.toFixed(),
        grossAmount: delta.negated().times(cost).toFixed(),
        rawRowHash: rowHash(SNAPSHOT_SOURCE, `${latest.batchId}|${p.securityId}|reduce`),
        notes: `Balance adjustment: your holdings statement of ${statement} shows fewer than your trades add up to.`,
      });
    }
  }
  for (let i = 0; i < rows.length; i += 100) await trx.insert(transactions).values(rows.slice(i, i + 100)).run();

  // Held per the trades but absent from the statement. Not adjusted — a statement can be partial
  // (one sheet of a workbook) — only reported. F&O never appears in a holdings statement.
  const listed = new Set(positions.map((p) => p.securityId));
  const derivatives = new Set(ledger.filter((t) => t.segment === "fno" || t.segment === "commodity").map((t) => t.securityId));
  const notInStatement = [...held.values()]
    .filter((h) => h.netQty.gt(0) && !listed.has(h.securityId) && !derivatives.has(h.securityId))
    .map((h) => secs.get(h.securityId)?.symbol ?? h.securityId)
    .sort();

  return { asOf: latest.asOf, opening, reduced, notInStatement };
}

/** After trades change by hand: re-derive every affected scope that has a statement. */
export async function refreshSnapshots(trx: Database, scopes: Scope[]): Promise<void> {
  const seen = new Set<string>();
  for (const s of scopes) {
    const key = `${s.portfolioId}|${s.accountId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (await hasSnapshot(trx, s)) await reconcileSnapshots(trx, s);
  }
}

/** Adapters whose rows used to be written straight into the ledger as buys. */
const LEGACY_STATEMENT_SOURCES = ["zerodha-holdings", "holdings"];

/**
 * Before snapshots existed, a holdings statement became buys dated to the day it was imported —
 * on top of the trades. Move those rows into snapshots (same quantities and prices, dated as they
 * were) and re-derive each account. Runs at startup; once converted there is nothing left to do.
 */
export async function convertLegacyStatements(db: DB): Promise<number> {
  const legacy = await db.select().from(transactions).where(inArray(transactions.sourceBroker, LEGACY_STATEMENT_SOURCES)).all();
  if (legacy.length === 0) return 0;
  await db.transaction(async (trx) => {
    const groups = new Map<string, typeof legacy>();
    for (const t of legacy) {
      const key = t.importBatchId ?? `${t.userId}|${t.portfolioId}|${t.accountId ?? ""}|${day(t.tradeDate)}`;
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    const scopes = new Map<string, Scope>();
    for (const rows of groups.values()) {
      const first = rows[0]!;
      let batchId = first.importBatchId;
      if (!batchId) {
        batchId = randomUUID();
        await trx
          .insert(importBatches)
          .values({ id: batchId, userId: first.userId, portfolioId: first.portfolioId, accountId: first.accountId, broker: first.sourceBroker ?? "holdings", filename: "holdings statement", fileHash: "legacy", status: "committed", rowsTotal: rows.length })
          .run();
      }
      const bySec = new Map<string, SnapshotPosition>();
      for (const t of rows) {
        if (!t.securityId || t.type !== "buy") continue;
        const prev = bySec.get(t.securityId);
        const qty = d(t.quantity);
        if (!prev) bySec.set(t.securityId, { securityId: t.securityId, quantity: qty.toFixed(), avgPrice: d(t.price).toFixed(), currency: t.currency });
        else {
          const total = d(prev.quantity).plus(qty);
          bySec.set(t.securityId, { ...prev, quantity: total.toFixed(), avgPrice: d(prev.quantity).times(prev.avgPrice).plus(qty.times(t.price)).div(total).toFixed() });
        }
      }
      const scope: Scope = { userId: first.userId, portfolioId: first.portfolioId, accountId: first.accountId };
      if (bySec.size) {
        await trx
          .insert(holdingSnapshots)
          .values([...bySec.values()].map((p) => ({ id: randomUUID(), userId: scope.userId, portfolioId: scope.portfolioId, accountId: scope.accountId, importBatchId: batchId!, asOf: first.tradeDate, ...p })))
          .run();
      }
      scopes.set(`${scope.userId}|${scope.portfolioId}|${scope.accountId ?? ""}`, scope);
    }
    await trx.delete(transactions).where(inArray(transactions.id, legacy.map((t) => t.id))).run();
    for (const scope of scopes.values()) await reconcileSnapshots(trx, scope);
  });
  invalidateAllHoldings(); // written outside any request, so nothing else drops the cache
  return legacy.length;
}
