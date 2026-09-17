import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { DB } from "../db/index.js";
import { authed } from "../lib/routes.js";
import type { MarketDataProvider } from "../market/types.js";
import { refreshQuotes, lastQuoteAsOf } from "../market/service.js";

const refreshSchema = z.object({ portfolioId: z.string().min(1).optional() });

export function registerMarketRoutes(app: FastifyInstance, db: DB, provider: MarketDataProvider): void {
  const opts = authed(app);

  app.post("/api/market-data/refresh", opts, async (req) => {
    const { portfolioId } = refreshSchema.parse(req.body ?? {});
    return refreshQuotes(db, req.user!.id, provider, portfolioId);
  });

  app.get("/api/market-data/status", opts, async (req) => {
    const { portfolioId } = req.query as { portfolioId?: string };
    return { provider: provider.id, lastUpdated: await lastQuoteAsOf(db, req.user!.id, portfolioId) };
  });
}
