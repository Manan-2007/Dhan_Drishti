import { desc } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { DB } from "../db/index.js";
import { exchangeRates } from "../db/schema.js";
import { authed } from "../lib/routes.js";
import type { FxProvider } from "../market/types.js";
import { refreshRates, setRate, backfillFxAtCost } from "../market/fx.js";

const setSchema = z.object({
  from: z.string().trim().length(3).toUpperCase(),
  to: z.string().trim().length(3).toUpperCase(),
  rate: z.string().trim().refine((s) => Number(s) > 0, "rate must be positive"),
});

export function registerFxRoutes(app: FastifyInstance, db: DB, provider: FxProvider): void {
  const opts = authed(app);

  // Latest rate per (from → to) pair.
  app.get("/api/exchange-rates", opts, async () => {
    const rows = await db.select().from(exchangeRates).orderBy(desc(exchangeRates.asOf)).all();
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const key = `${r.baseCurrency}>${r.quoteCurrency}`;
      if (!latest.has(key)) latest.set(key, r);
    }
    return { rates: [...latest.values()] };
  });

  app.post("/api/exchange-rates/refresh", opts, async (req) => {
    return refreshRates(db, req.user!.id, provider);
  });

  // Backfill FX-at-cost on existing foreign-currency trades (for return decomposition).
  app.post("/api/exchange-rates/backfill", opts, async (req) => {
    return backfillFxAtCost(db, req.user!.id, provider);
  });

  app.put("/api/exchange-rates", opts, async (req) => {
    const { from, to, rate } = setSchema.parse(req.body);
    await setRate(db, from, to, rate);
    return { ok: true };
  });
}
