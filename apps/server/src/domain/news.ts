import { inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { DB } from "../db/index.js";
import { securities } from "../db/schema.js";
import { authed } from "../lib/routes.js";
import { computePortfolioHoldings } from "./holdings.js";
import type { CompanyKey, NewsHub } from "../news/hub.js";
import type { Headline, Tone } from "../news/types.js";

/** News is followed for this many of the largest holdings. */
const MAX_COMPANIES = 30;
const FEED_SIZE = 80;

/** Public ticker for a listed share: NSE ".NS", BSE ".BO", otherwise the symbol as is. */
function tickerOf(symbol: string, exchange: string | null, currency: string): string {
  const ex = (exchange ?? "").toUpperCase();
  if (ex === "BSE") return `${symbol}.BO`;
  if (ex === "NSE" || currency === "INR") return `${symbol}.NS`;
  return symbol;
}

/**
 * Live index values and news about what you hold. Which companies, and how much of the portfolio
 * each one is, is worked out here; only public tickers and names go out (see news/hub.ts). The
 * weights are for this screen alone and never leave the machine.
 */
export function registerNewsRoutes(app: FastifyInstance, db: DB, hub: NewsHub | null): void {
  const opts = authed(app);

  app.get("/api/market/indices", opts, async () => ({
    live: !!hub,
    indices: hub ? await hub.indices() : [],
  }));

  app.get("/api/news", opts, async (req) => {
    const { portfolioId } = req.query as { portfolioId?: string };
    const data = await computePortfolioHoldings(db, req.user!.id, portfolioId);
    const held = data.holdings.filter((h) => h.security.assetClass === "equity" && Number(h.netQty) > 0);
    const valueOf = (h: (typeof held)[number]) => Math.max(0, Number(h.baseCurrentValue ?? h.baseInvested ?? 0));
    const total = held.reduce((s, h) => s + valueOf(h), 0);
    const ranked = [...held].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, MAX_COMPANIES);

    const secRows = ranked.length
      ? await db
          .select({ id: securities.id, exchange: securities.exchange })
          .from(securities)
          .where(inArray(securities.id, ranked.map((h) => h.security.id)))
          .all()
      : [];
    const exchangeOf = new Map(secRows.map((s) => [s.id, s.exchange]));

    // One entry per listed company (the same share can sit in two accounts).
    const companies = new Map<string, { key: CompanyKey; securityId: string; symbol: string; weight: number }>();
    for (const h of ranked) {
      const ticker = tickerOf(h.security.symbol.trim().toUpperCase(), exchangeOf.get(h.security.id) ?? null, h.security.currency);
      const weight = total > 0 ? valueOf(h) / total : 0;
      const had = companies.get(ticker);
      if (had) had.weight += weight;
      else
        companies.set(ticker, {
          key: { ticker, fallbackName: h.security.name || h.security.symbol },
          securityId: h.security.id,
          symbol: h.security.symbol,
          weight,
        });
    }

    if (!hub) return { live: false, ai: { enabled: false, label: null }, refreshing: false, market: { items: [], read: null, readAt: null }, companies: [], feed: [] };

    const snap = hub.snapshot([...companies.values()].map((c) => c.key));
    const out = snap.companies.map((c) => {
      const meta = companies.get(c.ticker)!;
      return { securityId: meta.securityId, symbol: meta.symbol, weight: meta.weight, ...c };
    });

    // One stream, newest first: a headline naming two of your companies shows once, tagged with both.
    type FeedItem = Headline & { tone: Tone | null; companies: { securityId: string; symbol: string; name: string }[]; market: boolean };
    const feed = new Map<string, FeedItem>();
    for (const c of out)
      for (const h of c.items) {
        const tag = { securityId: c.securityId, symbol: c.symbol, name: c.name };
        const had = feed.get(h.id);
        if (had) {
          had.companies.push(tag);
          had.tone ??= c.read?.tones[h.id] ?? null;
        } else feed.set(h.id, { ...h, tone: c.read?.tones[h.id] ?? null, companies: [tag], market: false });
      }
    for (const h of snap.market.items) if (!feed.has(h.id)) feed.set(h.id, { ...h, tone: snap.market.read?.tones[h.id] ?? null, companies: [], market: true });

    return {
      live: true,
      ai: { enabled: !!hub.analystLabel, label: hub.analystLabel },
      refreshing: snap.refreshing,
      market: snap.market,
      companies: out,
      feed: [...feed.values()].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1)).slice(0, FEED_SIZE),
    };
  });
}
