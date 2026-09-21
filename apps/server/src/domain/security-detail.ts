import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { DB } from "../db/index.js";
import { transactions, securities } from "../db/schema.js";
import { authed } from "../lib/routes.js";
import { NotFoundError } from "../lib/errors.js";
import type { SecurityHistoryProvider } from "../market/types.js";
import { getPortfolioOwned } from "./portfolios.js";
import { computePortfolioHoldings } from "./holdings.js";

const querySchema = z.object({ portfolioId: z.string().optional() });

/**
 * Everything the per-security detail page needs, in one call: the security, its live position
 * (from the same engine as Holdings, so the numbers match), the full transaction history for it,
 * and a public price-history series for the chart. The caller must actually hold/have traded the
 * security (a transaction in scope) — otherwise 404, so this never leaks the shared master.
 */
export function registerSecurityDetailRoutes(app: FastifyInstance, db: DB, historyProvider: SecurityHistoryProvider): void {
  const opts = authed(app);

  app.get("/api/securities/:id/detail", opts, async (req) => {
    const { id } = req.params as { id: string };
    const { portfolioId } = querySchema.parse(req.query);
    const userId = req.user!.id;
    if (portfolioId) await getPortfolioOwned(db, userId, portfolioId);

    const security = await db.select().from(securities).where(eq(securities.id, id)).get();
    if (!security) throw new NotFoundError("Security");

    const txClauses = [eq(transactions.userId, userId), eq(transactions.securityId, id)];
    if (portfolioId) txClauses.push(eq(transactions.portfolioId, portfolioId));
    const txRows = await db.select().from(transactions).where(and(...txClauses)).orderBy(desc(transactions.tradeDate), desc(transactions.createdAt)).all();
    if (txRows.length === 0) throw new NotFoundError("Position"); // not held / not traded by this user

    // Position from the same computation as the Holdings page, so every figure matches.
    const holdings = await computePortfolioHoldings(db, userId, portfolioId);
    const position = holdings.holdings.find((h) => h.security.id === id) ?? null;

    // Public price history for the chart (only the ticker/ISIN + a date range leave the machine).
    // Mutual funds and unlisted assets have none → an empty series, handled gracefully by the UI.
    let history: { date: string; close: number }[] = [];
    try {
      const from = txRows[txRows.length - 1]!.tradeDate.slice(0, 10); // earliest trade (rows are desc)
      const to = new Date().toISOString().slice(0, 10);
      history = await historyProvider.getHistory(
        { id: security.id, symbol: security.symbol, isin: security.isin, amfiCode: security.amfiCode, assetClass: security.assetClass, exchange: security.exchange, currency: security.currency },
        from,
        to,
      );
    } catch {
      history = [];
    }

    return {
      security: {
        id: security.id,
        symbol: security.symbol,
        name: security.name,
        assetClass: security.assetClass,
        sector: security.sector,
        subSector: security.subSector,
        isin: security.isin,
        exchange: security.exchange,
        currency: security.currency,
      },
      position,
      portfolioNetPnl: holdings.summary.netPnl, // for "contribution to return"
      baseCurrency: holdings.baseCurrency,
      transactions: txRows,
      history,
    };
  });
}
