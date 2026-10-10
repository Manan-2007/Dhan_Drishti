import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { fifoCapitalGains, financialYear, d, ZERO, type CanonicalTx, type Decimal, type UnmatchedSale } from "@dhan-drishti/core";
import { baseCurrencyOf, rateMap } from "../market/fx.js";
import { asOf, loadFx } from "../market/history-store.js";
import type { DB } from "../db/index.js";
import { transactions, securities } from "../db/schema.js";
import { scopeFromRequest, txScopeClauses, type ScopeArg } from "./scope.js";
import { authed } from "../lib/routes.js";
import { getPortfolioOwned } from "./portfolios.js";

/**
 * ITR-oriented capital-gains report. Uses FIFO lot matching (the tax method), separate from the
 * average-cost realised engine that powers Analytics. Short vs long term is decided per asset
 * class by the holding period below. F&O is excluded (business income). Informational only —
 * not tax advice; the user should confirm the current holding-period & rate rules.
 */

// Long-term holding threshold in days, by asset class. Listed equity & equity MFs qualify after
// 12 months; other assets use a conservative 24-month default. (Rules change with each Budget.)
const LONG_TERM_DAYS: Record<string, number> = { equity: 365, etf: 365, mf: 365 };
const DEFAULT_LONG_TERM_DAYS = 730;

const querySchema = z.object({ portfolioId: z.string().optional() });

interface TermTotals {
  gain: string;
  proceeds: string;
  cost: string;
  count: number;
}
const emptyTerm = (): { gain: Decimal; proceeds: Decimal; cost: Decimal; count: number } => ({ gain: ZERO, proceeds: ZERO, cost: ZERO, count: 0 });
const termOut = (t: { gain: Decimal; proceeds: Decimal; cost: Decimal; count: number }): TermTotals => ({
  gain: t.gain.toFixed(),
  proceeds: t.proceeds.toFixed(),
  cost: t.cost.toFixed(),
  count: t.count,
});

export async function computeCapitalGains(db: DB, userId: string, scope?: ScopeArg) {
  const clauses = await txScopeClauses(db, userId, scope);
  const txs = (await db.select().from(transactions).where(and(...clauses)).all()) as unknown as CanonicalTx[];

  const secIds = [...new Set(txs.map((t) => t.securityId).filter((x): x is string => !!x))];
  const secRows = secIds.length ? await db.select().from(securities).where(inArray(securities.id, secIds)).all() : [];
  const secById = new Map(secRows.map((s) => [s.id, s]));

  const longTermDays = (sid: string) => LONG_TERM_DAYS[secById.get(sid)?.assetClass ?? ""] ?? DEFAULT_LONG_TERM_DAYS;
  const unmatchedRaw: UnmatchedSale[] = [];
  const gains = fifoCapitalGains(txs, { longTermDays, onUnmatchedSale: (u) => unmatchedRaw.push(u) });

  // Tax is filed in rupees: a foreign sale converts at the rate on its sale day, its cost at the rate
  // on its purchase day (from the trade, else the cached daily rate, else today's — flagged).
  const base = await baseCurrencyOf(db, userId);
  const currencies = [...new Set(secRows.map((s) => s.currency))];
  const foreign = currencies.filter((c) => c !== base);
  const firstDay = gains.reduce((m, g) => (g.buyDate < m ? g.buyDate : m), new Date().toISOString().slice(0, 10));
  const [daily, latest] = await Promise.all([loadFx(db, foreign, base, firstDay), rateMap(db, foreign, base)]);
  let fxApprox = false;
  const rateOn = (ccy: string, date: string, onTrade: string | null): Decimal | null => {
    if (ccy === base) return d(1);
    if (onTrade) return d(onTrade);
    const r = asOf(daily.get(ccy), date);
    if (r !== null) return d(r);
    const l = latest.get(ccy);
    if (l) {
      fxApprox = true;
      return d(l);
    }
    return null;
  };

  const rows = gains
    .map((g) => {
      const sec = secById.get(g.securityId);
      const currency = sec?.currency ?? base;
      const sellRate = rateOn(currency, g.sellDate, g.sellFx);
      const buyRate = rateOn(currency, g.buyDate, g.buyFx);
      const proceedsBase = sellRate ? d(g.proceeds).times(sellRate) : null;
      const costBase = buyRate ? d(g.cost).times(buyRate) : null;
      return {
        ...g,
        symbol: sec?.symbol ?? "—",
        name: sec?.name ?? "—",
        assetClass: sec?.assetClass ?? "other",
        currency,
        proceedsBase: proceedsBase?.toFixed(2) ?? null,
        costBase: costBase?.toFixed(2) ?? null,
        gainBase: proceedsBase && costBase ? proceedsBase.minus(costBase).toFixed(2) : null,
      };
    })
    .sort((a, b) => (a.sellDate < b.sellDate ? 1 : a.sellDate > b.sellDate ? -1 : 0));

  // By financial year of the sale: short-term, long-term, and "unknown" — lots from a holdings
  // statement, bought before the files start, whose real holding period isn't known.
  type Bucket = ReturnType<typeof emptyTerm>;
  const fyMap = new Map<string, { short: Bucket; long: Bucket; unknown: Bucket }>();
  const totals = { short: emptyTerm(), long: emptyTerm(), unknown: emptyTerm() };
  for (const r of rows) {
    if (r.gainBase === null) continue;
    const fy = financialYear(r.sellDate);
    const bucket = fyMap.get(fy) ?? { short: emptyTerm(), long: emptyTerm(), unknown: emptyTerm() };
    const key = !r.buyDateKnown ? "unknown" : r.term === "long" ? "long" : "short";
    for (const acc of [bucket[key], totals[key]]) {
      acc.gain = acc.gain.plus(r.gainBase);
      acc.proceeds = acc.proceeds.plus(r.proceedsBase!);
      acc.cost = acc.cost.plus(r.costBase!);
      acc.count += 1;
    }
    fyMap.set(fy, bucket);
  }

  const unmatched = unmatchedRaw
    .map((u) => {
      const sec = secById.get(u.securityId);
      const currency = sec?.currency ?? base;
      const rate = rateOn(currency, u.sellDate, null);
      return { ...u, symbol: sec?.symbol ?? "—", name: sec?.name ?? "—", currency, proceedsBase: rate ? d(u.proceeds).times(rate).toFixed(2) : null, fy: financialYear(u.sellDate) };
    })
    .sort((a, b) => (a.sellDate < b.sellDate ? 1 : -1));

  const byFY = [...fyMap.entries()]
    .map(([key, v]) => ({ key, shortTerm: termOut(v.short), longTerm: termOut(v.long), unknownTerm: termOut(v.unknown) }))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
  const fyList = [...new Set([...byFY.map((f) => f.key), ...unmatched.map((u) => u.fy)])].sort().reverse();

  return {
    baseCurrency: base,
    rows,
    byFY,
    fyList,
    totals: { shortTerm: termOut(totals.short), longTerm: termOut(totals.long), unknownTerm: termOut(totals.unknown) },
    /** Sales of shares bought before the files start: no cost on record, so no gain can be worked out. */
    unmatched,
    currencies,
    fxApprox,
    disclaimer:
      "FIFO capital gains for reference only — not tax advice. Long-term uses 12 months for listed shares, equity ETFs and equity mutual funds and 24 months otherwise; confirm the current holding-period and rate rules for your assets. F&O and commodity futures are excluded (business income). Foreign sales are converted to rupees at the rate on the sale and purchase days.",
  };
}

export function registerReportRoutes(app: FastifyInstance, db: DB): void {
  const opts = authed(app);
  app.get("/api/reports/capital-gains", opts, async (req) => {
    const scope = await scopeFromRequest(db, req.user!.id, req.query);
    return computeCapitalGains(db, req.user!.id, scope);
  });
}
