import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { computeTechnicals } from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { securities, transactions } from "../db/schema.js";
import { authed } from "../lib/routes.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { TICKER_RE, marketOf, type TickerQuote, type TickerSource } from "../market/providers/yahoo-search.js";
import type { FundamentalsProvider } from "../market/providers/yahoo-fundamentals.js";
import type { BenchmarkBar } from "../market/types.js";

/**
 * Search and research for any listed stock — held or not. A stock you've traded maps back to your
 * own record (so the search can open your holding instead); anything else is public market data
 * only. Only the typed text or a public ticker leaves the machine.
 */

const searchSchema = z.object({ q: z.string().trim().min(1).max(60) });
const TTL = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: { quote: TickerQuote | null; history: BenchmarkBar[] } }>();

const tickerParam = (raw: string) => {
  const t = decodeURIComponent(raw).trim().toUpperCase();
  if (!TICKER_RE.test(t)) throw new BadRequestError("bad_ticker", "That isn't an Indian (NSE/BSE) or US ticker.");
  return t;
};
const baseSymbol = (ticker: string) => ticker.replace(/\.(NS|BO)$/, "");

/** Your traded securities, keyed by market and symbol, to map public tickers back to them. */
async function mine(db: DB, userId: string): Promise<Map<string, string>> {
  const ids = (await db.selectDistinct({ id: transactions.securityId }).from(transactions).where(eq(transactions.userId, userId)).all()).map((r) => r.id).filter((x): x is string => !!x);
  const rows = ids.length ? await db.select({ id: securities.id, symbol: securities.symbol, currency: securities.currency }).from(securities).where(inArray(securities.id, ids)).all() : [];
  return new Map(rows.map((s) => [`${s.currency === "INR" ? "in" : "us"}|${s.symbol.trim().toUpperCase()}`, s.id]));
}

export function registerDiscoverRoutes(app: FastifyInstance, db: DB, source: TickerSource | null, fundamentals: FundamentalsProvider | null): void {
  const opts = authed(app);

  app.get("/api/search", opts, async (req) => {
    const { q } = searchSchema.parse(req.query);
    if (!source) return { live: false, results: [] };
    const hits = await source.search(q);
    if (hits === null) return { live: false, results: [] };
    const own = await mine(db, req.user!.id);
    return { live: true, results: hits.map((h) => ({ ...h, securityId: own.get(`${h.market}|${baseSymbol(h.ticker)}`) ?? null })) };
  });

  app.get("/api/research/ticker/:ticker", opts, async (req) => {
    const ticker = tickerParam((req.params as { ticker: string }).ticker);
    if (!source) throw new NotFoundError("Market data");
    const own = await mine(db, req.user!.id);
    let hit = cache.get(ticker);
    if (!hit || Date.now() - hit.at > TTL) {
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 5 * 366 * 86_400_000).toISOString().slice(0, 10);
      const [quote, history] = await Promise.all([source.quote(ticker), source.history(ticker, from, to).catch(() => [])]);
      hit = { at: Date.now(), value: { quote, history } };
      if (quote || history.length) cache.set(ticker, hit);
    }
    const { quote, history } = hit.value;
    if (!quote && history.length === 0) throw new NotFoundError("Ticker");
    const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
    return {
      ticker,
      market: marketOf(ticker),
      name: quote?.name ?? ticker,
      currency: quote?.currency ?? (marketOf(ticker) === "in" ? "INR" : "USD"),
      exchange: quote?.exchange ?? "",
      quote: quote && quote.price !== null ? { price: quote.price, prevClose: quote.prevClose, asOf: quote.asOf } : null,
      /** Set when you've traded it — your own research view has your position too. */
      securityId: own.get(`${marketOf(ticker)}|${baseSymbol(ticker)}`) ?? null,
      history: sorted,
      technicals: computeTechnicals(sorted),
    };
  });

  app.get("/api/research/ticker/:ticker/fundamentals", opts, async (req) => {
    const ticker = tickerParam((req.params as { ticker: string }).ticker);
    if (!fundamentals) return { available: false, reason: "disabled" as const, ticker: null, fundamentals: null };
    const f = await fundamentals.getFundamentals(ticker);
    return f ? { available: true, reason: null, ticker, fundamentals: f } : { available: false, reason: "unavailable" as const, ticker, fundamentals: null };
  });
}
