import { and, eq, inArray, desc, or } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { d, ZERO, financialYear, type Decimal } from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { transactions, securities } from "../db/schema.js";
import { authed } from "../lib/routes.js";
import { baseCurrencyOf, rateMap } from "../market/fx.js";
import { getPortfolioOwned } from "./portfolios.js";

const querySchema = z.object({ portfolioId: z.string().optional() });

/**
 * Dividend & interest income, straight from the ledger. Every figure traces to a real
 * `dividend`/`interest` transaction — nothing is estimated or projected. Amounts are shown
 * in their own currency and, where an FX rate exists, aggregated into the base currency;
 * income whose currency has no rate is excluded from base totals and flagged (never faked).
 */
export async function computeDividends(db: DB, userId: string, portfolioId?: string) {
  const clauses = [eq(transactions.userId, userId), or(eq(transactions.type, "dividend"), eq(transactions.type, "interest"))!];
  if (portfolioId) clauses.push(eq(transactions.portfolioId, portfolioId));
  const rows = await db
    .select()
    .from(transactions)
    .where(and(...clauses))
    .orderBy(desc(transactions.tradeDate))
    .all();

  const secIds = [...new Set(rows.map((r) => r.securityId).filter((x): x is string => !!x))];
  const secRows = secIds.length ? await db.select().from(securities).where(inArray(securities.id, secIds)).all() : [];
  const secById = new Map(secRows.map((s) => [s.id, s]));

  const base = await baseCurrencyOf(db, userId);
  const rates = await rateMap(db, [...new Set(rows.map((r) => r.currency))], base);
  const toBase = (amount: Decimal, currency: string): Decimal | null => {
    if (currency === base) return amount;
    const rate = rates.get(currency) ?? null;
    return rate === null ? null : amount.times(rate);
  };

  let total = ZERO;
  const unconvertible = new Set<string>();
  const byFY = new Map<string, Decimal>();
  const bySecurity = new Map<string, { name: string; symbol: string; amount: Decimal }>();
  const events = rows.map((r) => {
    const amount = d(r.grossAmount);
    const baseAmount = toBase(amount, r.currency);
    if (baseAmount === null) unconvertible.add(r.currency);
    else {
      total = total.plus(baseAmount);
      const fy = financialYear(r.tradeDate);
      byFY.set(fy, (byFY.get(fy) ?? ZERO).plus(baseAmount));
      if (r.securityId) {
        const sec = secById.get(r.securityId);
        const cur = bySecurity.get(r.securityId) ?? { name: sec?.name ?? "—", symbol: sec?.symbol ?? "—", amount: ZERO };
        cur.amount = cur.amount.plus(baseAmount);
        bySecurity.set(r.securityId, cur);
      }
    }
    const sec = r.securityId ? secById.get(r.securityId) : undefined;
    return {
      id: r.id,
      type: r.type,
      tradeDate: r.tradeDate,
      amount: amount.toFixed(),
      currency: r.currency,
      baseAmount: baseAmount === null ? null : baseAmount.toFixed(),
      security: sec ? { id: sec.id, symbol: sec.symbol, name: sec.name } : null,
    };
  });

  return {
    baseCurrency: base,
    fxComplete: unconvertible.size === 0,
    unconvertibleCurrencies: [...unconvertible],
    total: total.toFixed(),
    count: rows.length,
    byFY: [...byFY.entries()].map(([key, v]) => ({ key, amount: v.toFixed() })).sort((a, b) => (a.key < b.key ? 1 : -1)),
    bySecurity: [...bySecurity.values()]
      .map((s) => ({ symbol: s.symbol, name: s.name, amount: s.amount.toFixed() }))
      .sort((a, b) => Number(b.amount) - Number(a.amount)),
    events,
  };
}

export function registerDividendRoutes(app: FastifyInstance, db: DB): void {
  const opts = authed(app);
  app.get("/api/dividends", opts, async (req) => {
    const { portfolioId } = querySchema.parse(req.query);
    if (portfolioId) await getPortfolioOwned(db, req.user!.id, portfolioId);
    return computeDividends(db, req.user!.id, portfolioId);
  });
}
