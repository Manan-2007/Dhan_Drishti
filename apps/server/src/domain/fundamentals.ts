import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { DB } from "../db/index.js";
import { securities, transactions } from "../db/schema.js";
import { authed } from "../lib/routes.js";
import { NotFoundError } from "../lib/errors.js";
import { getPortfolioOwned } from "./portfolios.js";
import type { FundamentalsProvider } from "../market/providers/yahoo-fundamentals.js";

const querySchema = z.object({ portfolioId: z.string().optional() });

/** Public ticker for a listed share: NSE ".NS", BSE ".BO", INR default ".NS", else the symbol. */
function tickerOf(symbol: string, exchange: string | null, currency: string): string {
  const sym = symbol.trim().toUpperCase();
  const ex = (exchange ?? "").toUpperCase();
  if (ex === "BSE") return `${sym}.BO`;
  if (ex === "NSE" || currency === "INR") return `${sym}.NS`;
  return sym;
}

/** Which asset classes have company fundamentals on Yahoo (funds, cash, crypto don't). */
const HAS_FUNDAMENTALS = new Set(["equity", "etf", "reit_invit"]);

/**
 * Company fundamentals for one of the user's held securities. Kept off the detail call so the page
 * loads instantly and these stream in; the caller must hold/have traded the security (a transaction
 * in scope), so this never leaks the shared master. Only the public ticker leaves the machine.
 */
export function registerFundamentalsRoutes(app: FastifyInstance, db: DB, provider: FundamentalsProvider | null): void {
  const opts = authed(app);

  app.get("/api/securities/:id/fundamentals", opts, async (req) => {
    const { id } = req.params as { id: string };
    const { portfolioId } = querySchema.parse(req.query);
    const userId = req.user!.id;
    if (portfolioId) await getPortfolioOwned(db, userId, portfolioId);

    const security = await db.select().from(securities).where(eq(securities.id, id)).get();
    if (!security) throw new NotFoundError("Security");

    const txClauses = [eq(transactions.userId, userId), eq(transactions.securityId, id)];
    if (portfolioId) txClauses.push(eq(transactions.portfolioId, portfolioId));
    const traded = await db.select({ id: transactions.id }).from(transactions).where(and(...txClauses)).limit(1).get();
    if (!traded) throw new NotFoundError("Position"); // not held / not traded by this user

    if (!provider) return { available: false, reason: "disabled" as const, ticker: null, fundamentals: null };
    if (!HAS_FUNDAMENTALS.has(security.assetClass)) return { available: false, reason: "no_fundamentals" as const, ticker: null, fundamentals: null };

    const ticker = tickerOf(security.symbol, security.exchange, security.currency);
    const fundamentals = await provider.getFundamentals(ticker);
    return fundamentals ? { available: true, reason: null, ticker, fundamentals } : { available: false, reason: "unavailable" as const, ticker, fundamentals: null };
  });
}
