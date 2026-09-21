import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { fifoCapitalGains, financialYear, d, ZERO, type CanonicalTx, type Decimal } from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { transactions, securities } from "../db/schema.js";
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

export async function computeCapitalGains(db: DB, userId: string, portfolioId?: string) {
  const clauses = [eq(transactions.userId, userId)];
  if (portfolioId) clauses.push(eq(transactions.portfolioId, portfolioId));
  const txs = (await db.select().from(transactions).where(and(...clauses)).all()) as unknown as CanonicalTx[];

  const secIds = [...new Set(txs.map((t) => t.securityId).filter((x): x is string => !!x))];
  const secRows = secIds.length ? await db.select().from(securities).where(inArray(securities.id, secIds)).all() : [];
  const secById = new Map(secRows.map((s) => [s.id, s]));

  const longTermDays = (sid: string) => LONG_TERM_DAYS[secById.get(sid)?.assetClass ?? ""] ?? DEFAULT_LONG_TERM_DAYS;
  const gains = fifoCapitalGains(txs, { longTermDays });

  const currencies = new Set<string>();
  const rows = gains
    .map((g) => {
      const sec = secById.get(g.securityId);
      const currency = sec?.currency ?? "INR";
      currencies.add(currency);
      return { ...g, symbol: sec?.symbol ?? "—", name: sec?.name ?? "—", assetClass: sec?.assetClass ?? "other", currency };
    })
    .sort((a, b) => (a.sellDate < b.sellDate ? 1 : a.sellDate > b.sellDate ? -1 : 0));

  // Group by the financial year of the sale, split into short- and long-term buckets.
  const fyMap = new Map<string, { short: ReturnType<typeof emptyTerm>; long: ReturnType<typeof emptyTerm> }>();
  const totals = { short: emptyTerm(), long: emptyTerm() };
  for (const g of gains) {
    const fy = financialYear(g.sellDate);
    const bucket = fyMap.get(fy) ?? { short: emptyTerm(), long: emptyTerm() };
    const term = g.term === "long" ? bucket.long : bucket.short;
    const tot = g.term === "long" ? totals.long : totals.short;
    for (const acc of [term, tot]) {
      acc.gain = acc.gain.plus(g.gain);
      acc.proceeds = acc.proceeds.plus(g.proceeds);
      acc.cost = acc.cost.plus(g.cost);
      acc.count += 1;
    }
    fyMap.set(fy, bucket);
  }

  const byFY = [...fyMap.entries()]
    .map(([key, v]) => ({ key, shortTerm: termOut(v.short), longTerm: termOut(v.long) }))
    .sort((a, b) => (a.key < b.key ? 1 : -1));

  return {
    rows,
    byFY,
    fyList: byFY.map((f) => f.key),
    totals: { shortTerm: termOut(totals.short), longTerm: termOut(totals.long) },
    currencies: [...currencies],
    currencyNote: currencies.size > 1 ? "Gains span multiple currencies and are shown in each security's own currency — totals mix currencies." : undefined,
    disclaimer:
      "FIFO capital gains for reference only — not tax advice. Long-term uses 12 months for listed equity & equity mutual funds and 24 months otherwise; confirm the current holding-period and rate rules for your assets. F&O is excluded (business income).",
  };
}

export function registerReportRoutes(app: FastifyInstance, db: DB): void {
  const opts = authed(app);
  app.get("/api/reports/capital-gains", opts, async (req) => {
    const { portfolioId } = querySchema.parse(req.query);
    if (portfolioId) await getPortfolioOwned(db, req.user!.id, portfolioId);
    return computeCapitalGains(db, req.user!.id, portfolioId);
  });
}
