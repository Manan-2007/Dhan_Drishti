import { eq, inArray } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { holdingSnapshots, securities, transactions } from "../db/schema.js";
import { parseDerivativeSymbol } from "../market/derivative-symbol.js";
import { invalidateAllHoldings } from "../domain/holdings-cache.js";
import { reclassifyHeld } from "../domain/securities.js";
import { findListing } from "./listings.js";
import { reconcileSnapshots, type Scope } from "./snapshot.js";
import type { SecurityRef } from "./types.js";

/**
 * One listed company, one security. A broker row that names a share in words (Dhan) or gives a
 * ticker without an ISIN is resolved to its NSE listing (listings.ts) before the security is found
 * or created, so it lands on the same security as the Zerodha row for that share — priced, with
 * history, sector and one line in Positions.
 */

/** Only Indian listed shares, ETFs and trusts; never funds, crypto, foreign shares or F&O contracts. */
function resolvable(ref: { symbol: string; name?: string | null; assetClass: string }, currency: string): boolean {
  if (currency !== "INR" || ref.assetClass === "mf" || ref.assetClass === "crypto") return false;
  return !parseDerivativeSymbol(ref.symbol, ref.name ?? undefined);
}

const named = (symbol: string) => /\s/.test(symbol.trim());

export function canonicalRef(ref: SecurityRef, currency: string): SecurityRef {
  if (!resolvable(ref, currency)) return ref;
  if (!named(ref.symbol) && ref.isin) return ref; // already a ticker with its ISIN
  const hit = findListing({ name: ref.name ?? ref.symbol, symbol: ref.symbol, isin: ref.isin });
  if (!hit) return ref;
  return {
    ...ref,
    symbol: hit.symbol,
    isin: ref.isin ?? hit.isin ?? undefined,
    exchange: ref.exchange ?? "NSE",
    name: named(ref.symbol) ? hit.name : ref.name,
    assetClass: ref.assetClass === "equity" && hit.kind !== "equity" ? hit.kind : ref.assetClass,
  };
}

/**
 * One-time repair for securities created before this existed: resolve each worded one to its
 * listing, and fold duplicates ("KOTAK BANK", "KOTAK MAHINDRA BANK LTD", "…LTD.") into one — every
 * trade, dividend and statement position moves across; nothing is dropped. Returns how many changed.
 */
export async function canonicalizeSecurities(db: DB): Promise<number> {
  const all = await db.select().from(securities).all();
  const candidates = all.filter((s) => named(s.symbol) && resolvable(s, s.currency));
  if (candidates.length === 0) return 0;

  const affected = new Set<string>();
  let changed = 0;
  await db.transaction(async (trx) => {
    for (const sec of candidates) {
      const hit = findListing({ name: sec.name, symbol: sec.symbol, isin: sec.isin });
      if (!hit) continue;
      const target =
        (hit.isin ? all.find((x) => x.id !== sec.id && x.isin === hit.isin) : undefined) ??
        all.find((x) => x.id !== sec.id && x.symbol === hit.symbol && (x.exchange === "NSE" || x.exchange === null));
      const users = await trx.selectDistinct({ userId: transactions.userId }).from(transactions).where(eq(transactions.securityId, sec.id)).all();
      for (const u of users) affected.add(u.userId);
      if (target) {
        await trx.update(transactions).set({ securityId: target.id }).where(eq(transactions.securityId, sec.id)).run();
        await trx.update(holdingSnapshots).set({ securityId: target.id }).where(eq(holdingSnapshots.securityId, sec.id)).run();
        await trx.delete(securities).where(eq(securities.id, sec.id)).run(); // its quotes go with it; the target has its own
        all.splice(all.indexOf(sec), 1);
      } else {
        const update = {
          symbol: hit.symbol,
          isin: sec.isin ?? hit.isin,
          exchange: "NSE",
          name: hit.name,
          assetClass: sec.assetClass === "equity" && hit.kind !== "equity" ? hit.kind : sec.assetClass,
          updatedAt: new Date().toISOString(),
        };
        await trx.update(securities).set(update).where(eq(securities.id, sec.id)).run();
        Object.assign(sec, update);
      }
      changed++;
    }

    // Statements now line up with the merged trades: re-derive their opening balances.
    if (affected.size) {
      const scopes = await trx
        .selectDistinct({ userId: holdingSnapshots.userId, portfolioId: holdingSnapshots.portfolioId, accountId: holdingSnapshots.accountId })
        .from(holdingSnapshots)
        .where(inArray(holdingSnapshots.userId, [...affected]))
        .all();
      for (const s of scopes as Scope[]) await reconcileSnapshots(trx, s);
    }
  });

  for (const userId of affected) {
    try {
      await reclassifyHeld(db, userId); // sectors for the now-recognised tickers
    } catch {
      /* cosmetic */
    }
  }
  invalidateAllHoldings();
  return changed;
}
