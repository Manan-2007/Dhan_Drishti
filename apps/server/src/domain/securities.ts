import { randomUUID } from "node:crypto";
import { and, eq, or, like, isNull } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { ASSET_CLASSES } from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { securities, type Security } from "../db/schema.js";
import { NotFoundError } from "../lib/errors.js";
import { authed } from "../lib/routes.js";
import { parseCsv, pick } from "../import/csv.js";

const metadataSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  assetClass: z.enum(ASSET_CLASSES).optional(),
  sector: z.string().max(60).nullable().optional(),
  subSector: z.string().max(60).nullable().optional(),
  isin: z.string().trim().length(12).nullable().optional(),
  amfiCode: z.string().trim().max(20).nullable().optional(),
  exchange: z.string().trim().max(20).nullable().optional(),
});

const classifySchema = z.object({ content: z.string().min(1).max(20_000_000) });

const upsertSchema = z.object({
  symbol: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  isin: z.string().trim().length(12).optional(),
  amfiCode: z.string().trim().max(20).optional(),
  assetClass: z.enum(ASSET_CLASSES).default("equity"),
  subClass: z.string().max(60).optional(),
  sector: z.string().max(60).optional(),
  subSector: z.string().max(60).optional(),
  currency: z.string().trim().length(3).toUpperCase().default("INR"),
  exchange: z.string().trim().max(20).optional(),
});

/**
 * Find-or-create a security in the shared master. Resolution order matches the importer's
 * identity resolver (docs/IMPORTERS.md): ISIN → symbol+exchange → symbol.
 */
export async function findOrCreateSecurity(
  db: DB,
  input: z.infer<typeof upsertSchema>,
): Promise<{ security: Security; created: boolean }> {
  if (input.isin) {
    const byIsin = await db.select().from(securities).where(eq(securities.isin, input.isin)).get();
    if (byIsin) return { security: byIsin, created: false };
  }
  const symbolMatch = input.exchange
    ? and(eq(securities.symbol, input.symbol), eq(securities.exchange, input.exchange))
    : and(eq(securities.symbol, input.symbol), isNull(securities.exchange));
  const bySymbol = await db.select().from(securities).where(symbolMatch).get();
  if (bySymbol) return { security: bySymbol, created: false };

  const row = {
    id: randomUUID(),
    symbol: input.symbol,
    name: input.name,
    isin: input.isin ?? null,
    amfiCode: input.amfiCode ?? null,
    assetClass: input.assetClass,
    subClass: input.subClass ?? null,
    sector: input.sector ?? null,
    subSector: input.subSector ?? null,
    currency: input.currency,
    exchange: input.exchange ?? null,
  };
  await db.insert(securities).values(row).run();
  const created = await db.select().from(securities).where(eq(securities.id, row.id)).get();
  return { security: created!, created: true };
}

export function registerSecurityRoutes(app: FastifyInstance, db: DB): void {
  const opts = authed(app);

  app.get("/api/securities", opts, async (req) => {
    const { query, limit } = req.query as { query?: string; limit?: string };
    const lim = Math.min(Number(limit ?? 50) || 50, 200);
    if (query && query.trim()) {
      const q = `%${query.trim()}%`;
      const rows = await db
        .select()
        .from(securities)
        .where(or(like(securities.symbol, q), like(securities.name, q), like(securities.isin, q)))
        .limit(lim)
        .all();
      return { securities: rows };
    }
    return { securities: await db.select().from(securities).limit(lim).all() };
  });

  app.post("/api/securities", opts, async (req, reply) => {
    const body = upsertSchema.parse(req.body);
    const { security, created } = await findOrCreateSecurity(db, body);
    reply.code(created ? 201 : 200).send({ security, created });
  });

  app.get("/api/securities/:id", opts, async (req) => {
    const { id } = req.params as { id: string };
    const row = await db.select().from(securities).where(eq(securities.id, id)).get();
    if (!row) throw new NotFoundError("Security");
    return { security: row };
  });

  // Edit descriptive/user metadata on a security (name, class, sector…).
  app.put("/api/securities/:id", opts, async (req) => {
    const { id } = req.params as { id: string };
    const body = metadataSchema.parse(req.body);
    const existing = await db.select().from(securities).where(eq(securities.id, id)).get();
    if (!existing) throw new NotFoundError("Security");
    await db
      .update(securities)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(securities.id, id))
      .run();
    return { security: await db.select().from(securities).where(eq(securities.id, id)).get() };
  });

  // Bulk-classify securities from a reference CSV (e.g. an exchange master):
  // columns symbol/ticker (+ optional name, asset_class, sector, sub_sector, amfi).
  app.post("/api/securities/classify", opts, async (req) => {
    const { content } = classifySchema.parse(req.body);
    const csv = parseCsv(content);
    let updated = 0;
    const notFound: string[] = [];
    for (const row of csv.rows) {
      const symbol = pick(row, ["symbol", "ticker", "nse ticker", "tradingsymbol"])?.toUpperCase();
      if (!symbol) continue;
      const patch: Record<string, string> = {};
      const name = pick(row, ["name"]);
      const ac = pick(row, ["asset_class", "assetclass", "class"]);
      const sector = pick(row, ["sector"]);
      const subSector = pick(row, ["sub_sector", "subsector", "subsubsector"]);
      const amfi = pick(row, ["amfi", "amfi_code", "amficode"]);
      if (name) patch.name = name;
      if (ac && (ASSET_CLASSES as readonly string[]).includes(ac.toLowerCase())) patch.assetClass = ac.toLowerCase();
      if (sector) patch.sector = sector;
      if (subSector) patch.subSector = subSector;
      if (amfi) patch.amfiCode = amfi;
      if (Object.keys(patch).length === 0) continue;
      const res = await db.update(securities).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(securities.symbol, symbol)).run();
      if (res.rowsAffected > 0) updated += res.rowsAffected;
      else notFound.push(symbol);
    }
    return { updated, notFound: notFound.slice(0, 100), notFoundCount: notFound.length };
  });
}
