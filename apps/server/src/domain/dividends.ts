import { and, eq, inArray, desc, or } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { d, ZERO, financialYear, type Decimal } from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { transactions, securities } from "../db/schema.js";
import { authed } from "../lib/routes.js";
import { baseCurrencyOf, rateMap } from "../market/fx.js";
import { getPortfolioOwned } from "./portfolios.js";
import { computePortfolioHoldings } from "./holdings.js";

const querySchema = z.object({ portfolioId: z.string().optional() });

const DAY = 86_400_000;
type Cadence = "monthly" | "quarterly" | "half-yearly" | "annual" | "irregular" | "one-off";

/** Median gap (in days) between consecutive payout dates, and the implied cadence label. */
function inferCadence(datesAsc: string[]): { cadence: Cadence; medianDays: number | null } {
  if (datesAsc.length < 2) return { cadence: "one-off", medianDays: null };
  const gaps: number[] = [];
  for (let i = 1; i < datesAsc.length; i++) {
    const g = (Date.parse(datesAsc[i]!) - Date.parse(datesAsc[i - 1]!)) / DAY;
    if (Number.isFinite(g) && g > 0) gaps.push(g);
  }
  if (gaps.length === 0) return { cadence: "one-off", medianDays: null };
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  const cadence: Cadence =
    median < 45 ? "monthly" : median < 135 ? "quarterly" : median < 270 ? "half-yearly" : median < 450 ? "annual" : "irregular";
  return { cadence, medianDays: median };
}

/**
 * Estimate the next payout date from a real historical cadence. Anchored to the last actual
 * payout + median interval, rolled forward to the next future occurrence. Returns null when the
 * security has gone quiet (last payout older than ~2 cycles) — we never invent a resumption.
 */
function estimateNextDate(lastDate: string, medianDays: number | null, todayMs: number): string | null {
  if (medianDays == null || medianDays <= 0) return null;
  const lastMs = Date.parse(lastDate);
  if (!Number.isFinite(lastMs)) return null;
  if (todayMs - lastMs > 2 * medianDays * DAY) return null; // paused → don't predict
  let nextMs = lastMs + medianDays * DAY;
  for (let i = 0; i < 6 && nextMs < todayMs; i++) nextMs += medianDays * DAY;
  return new Date(nextMs).toISOString().slice(0, 10);
}

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

  // ---- Trailing-12-month income, yield & an estimated forward calendar ----
  // Everything is either a real sum (TTM income) or a clearly-labelled estimate derived from
  // the security's own payout cadence (next-date). Current values come from the holdings engine.
  const now = new Date();
  const todayMs = now.getTime();
  const today = now.toISOString().slice(0, 10);
  const windowFrom = new Date(todayMs - 365 * DAY).toISOString().slice(0, 10);

  const holdings = await computePortfolioHoldings(db, userId, portfolioId);
  const heldById = new Map(holdings.holdings.filter((h) => h.netQty !== "0").map((h) => [h.security.id, h]));

  // Per-security payout history (ascending), base-currency amounts, for cadence + TTM.
  const perSec = new Map<string, { name: string; symbol: string; datesAsc: string[]; amountsAsc: (Decimal | null)[] }>();
  for (const r of [...rows].reverse()) {
    if (!r.securityId) continue;
    const sec = secById.get(r.securityId);
    const cur = perSec.get(r.securityId) ?? { name: sec?.name ?? "—", symbol: sec?.symbol ?? "—", datesAsc: [], amountsAsc: [] };
    cur.datesAsc.push(r.tradeDate.slice(0, 10));
    cur.amountsAsc.push(toBase(d(r.grossAmount), r.currency));
    perSec.set(r.securityId, cur);
  }

  let ttmAll = ZERO;
  let ttmHeld = ZERO;
  let heldValue = ZERO;
  let heldValueKnown = false;
  const upcoming: {
    security: { id: string; symbol: string; name: string };
    cadence: Cadence;
    paymentsObserved: number;
    lastDate: string;
    lastAmount: string | null;
    ttm: string;
    currentValue: string | null;
    trailingYield: string | null;
    estimatedNext: string | null;
  }[] = [];

  for (const [secId, h] of perSec) {
    const ttm = h.datesAsc.reduce((acc, day, i) => (day >= windowFrom && h.amountsAsc[i] ? acc.plus(h.amountsAsc[i]!) : acc), ZERO);
    ttmAll = ttmAll.plus(ttm);
    const held = heldById.get(secId);
    if (!held) continue; // forward calendar is only for positions you still hold
    ttmHeld = ttmHeld.plus(ttm);
    const cv = held.baseCurrentValue;
    if (cv !== null) {
      heldValue = heldValue.plus(cv);
      heldValueKnown = true;
    }
    const { cadence, medianDays } = inferCadence(h.datesAsc);
    const lastDate = h.datesAsc[h.datesAsc.length - 1]!;
    const lastAmount = h.amountsAsc[h.amountsAsc.length - 1];
    upcoming.push({
      security: { id: secId, symbol: h.symbol, name: h.name },
      cadence,
      paymentsObserved: h.datesAsc.length,
      lastDate,
      lastAmount: lastAmount ? lastAmount.toFixed() : null,
      ttm: ttm.toFixed(),
      currentValue: cv,
      trailingYield: cv !== null && d(cv).greaterThan(0) ? ttm.div(d(cv)).toFixed() : null,
      estimatedNext: estimateNextDate(lastDate, medianDays, todayMs),
    });
  }

  // Soonest estimated payout first; securities with no estimate fall to the bottom by TTM.
  upcoming.sort((a, b) => {
    if (a.estimatedNext && b.estimatedNext) return a.estimatedNext < b.estimatedNext ? -1 : 1;
    if (a.estimatedNext) return -1;
    if (b.estimatedNext) return 1;
    return Number(b.ttm) - Number(a.ttm);
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
    income: {
      ttm: ttmAll.toFixed(),
      ttmHeld: ttmHeld.toFixed(),
      portfolioValue: heldValueKnown ? heldValue.toFixed() : null,
      trailingYield: heldValueKnown && heldValue.greaterThan(0) ? ttmHeld.div(heldValue).toFixed() : null,
      asOf: today,
      windowFrom,
    },
    upcoming,
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
