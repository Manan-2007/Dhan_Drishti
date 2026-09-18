import { randomUUID } from "node:crypto";
import { and, eq, or, like, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { ASSET_CLASSES } from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { securities, transactions, type Security } from "../db/schema.js";
import { NotFoundError } from "../lib/errors.js";
import { authed } from "../lib/routes.js";
import { parseCsv, pick } from "../import/csv.js";
import { classifyInstrument } from "../import/classify-builtin.js";

/**
 * Apply the built-in classifier to every security the user holds — filling sector / sub-sector
 * where empty, and correcting the asset class of clearly non-equity instruments (a liquid fund
 * imported as equity becomes cash/debt, an SGB becomes an SGB…). Never overrides values the
 * user set themselves (only fills blanks / corrects the import default).
 */
export async function reclassifyHeld(db: DB, userId: string): Promise<{ updated: number }> {
  const idRows = await db.selectDistinct({ securityId: transactions.securityId }).from(transactions).where(eq(transactions.userId, userId)).all();
  const ids = idRows.map((r) => r.securityId).filter((x): x is string => !!x);
  if (ids.length === 0) return { updated: 0 };
  const secs = await db.select().from(securities).where(inArray(securities.id, ids)).all();
  let updated = 0;
  for (const s of secs) {
    const cls = classifyInstrument(s.symbol, s.name);
    if (!cls) continue;
    const patch: Record<string, string> = {};
    if (!s.sector && cls.sector) patch.sector = cls.sector;
    if (!s.subSector && cls.subSector) patch.subSector = cls.subSector;
    if (cls.assetClass && cls.assetClass !== "equity" && s.assetClass === "equity") patch.assetClass = cls.assetClass;
    if (Object.keys(patch).length === 0) continue;
    await db.update(securities).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(securities.id, s.id)).run();
    updated += 1;
  }
  return { updated };
}

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

  // Auto-classify held securities with the built-in classifier (sectors, sub-sectors, asset class).
  app.post("/api/securities/reclassify", opts, async (req) => {
    return reclassifyHeld(db, req.user!.id);
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
