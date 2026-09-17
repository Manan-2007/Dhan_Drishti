import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { DB } from "../db/index.js";
import { importBatches } from "../db/schema.js";
import { authed } from "../lib/routes.js";
import { listAdapters } from "../import/registry.js";
import { previewImport, commitImport, getBatch } from "../import/service.js";

const mappingSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().optional(),
  isin: z.string().optional(),
  date: z.string().min(1),
  type: z.string().min(1),
  quantity: z.string().min(1),
  price: z.string().min(1),
  amount: z.string().optional(),
  fees: z.string().optional(),
  taxes: z.string().optional(),
  currency: z.string().length(3).optional(),
  buyValues: z.array(z.string()).optional(),
  sellValues: z.array(z.string()).optional(),
});

const importSchema = z.object({
  portfolioId: z.string().min(1),
  accountId: z.string().min(1).nullable().optional(),
  broker: z.string().min(1),
  filename: z.string().min(1).max(255),
  content: z.string().min(1).max(20_000_000), // ~20MB cap
  mapping: mappingSchema.optional(),
});

export function registerImportRoutes(app: FastifyInstance, db: DB): void {
  const opts = authed(app);

  app.get("/api/imports/brokers", opts, async () => ({ brokers: listAdapters() }));

  app.post("/api/imports/check", opts, async (req) => {
    const body = importSchema.parse(req.body);
    return previewImport(db, req.user!.id, body);
  });

  app.post("/api/imports/commit", opts, async (req, reply) => {
    const body = importSchema.parse(req.body);
    const result = await commitImport(db, req.user!.id, body);
    reply.code(201).send(result);
  });

  app.get("/api/imports", opts, async (req) => {
    const rows = await db
      .select()
      .from(importBatches)
      .where(eq(importBatches.userId, req.user!.id))
      .orderBy(desc(importBatches.createdAt))
      .all();
    return { imports: rows };
  });

  app.get("/api/imports/:id", opts, async (req) => {
    const { id } = req.params as { id: string };
    return { import: await getBatch(db, req.user!.id, id) };
  });
}
