import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { DB } from "../db/index.js";
import { importBatches } from "../db/schema.js";
import { authed } from "../lib/routes.js";
import { listAdapters } from "../import/registry.js";
import { previewImport, commitImport, getBatch } from "../import/service.js";
import { seedPricesFromHoldings } from "../import/seed-prices.js";
import { commitMany, detectUpload } from "../import/batch.js";
import type { BenchmarkProvider } from "../market/types.js";
import { refreshExpirySettlements } from "../import/expiry.js";

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
  content: z.string().min(1).max(24_000_000), // ~24MB cap (base64 inflates a ~1MB .xlsx to ~1.4MB)
  encoding: z.enum(["base64"]).optional(),
  casPassword: z.string().max(200).optional(),
  mapping: mappingSchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  replace: z.boolean().optional(),
});

const uploadSchema = z.object({
  filename: z.string().min(1).max(255),
  content: z.string().min(1).max(24_000_000),
  encoding: z.enum(["base64"]).optional(),
  casPassword: z.string().max(200).optional(),
});

const targetSchema = z.union([
  z.object({ accountId: z.string().min(1), adoptRef: z.string().trim().max(60).nullable().optional() }),
  z.object({
    newAccount: z.object({
      portfolioId: z.string().min(1).optional(),
      newPortfolioName: z.string().trim().min(1).max(120).optional(),
      broker: z.string().min(1).max(40),
      accountRef: z.string().trim().max(60).nullable().optional(),
      name: z.string().trim().min(1).max(120),
      currency: z.string().trim().length(3).optional(),
    }),
  }),
]);

const commitManySchema = z.object({
  items: z
    .array(
      uploadSchema.extend({
        kind: z.enum(["transactions", "prices", "pnl_report"]),
        adapter: z.string().min(1).max(40).optional(),
        target: targetSchema.optional(),
      }),
    )
    .min(1)
    .max(50),
});

const seedPricesSchema = z.object({
  portfolioId: z.string().min(1).nullable().optional(),
  filename: z.string().min(1).max(255).optional(),
  content: z.string().min(1).max(24_000_000),
  encoding: z.enum(["base64"]).optional(),
});

/**
 * `settle`: after an import, fetch any expiry prices still missing and settle those contracts —
 * in the background, so the import answers at once. Off in tests (no network), on in the server.
 */
export function registerImportRoutes(app: FastifyInstance, db: DB, settle?: BenchmarkProvider): void {
  const opts = authed(app);
  const settleLater = (userId: string) => {
    if (settle) void refreshExpirySettlements(db, userId, settle).catch(() => undefined);
  };

  app.get("/api/imports/brokers", opts, async () => ({ brokers: listAdapters() }));

  app.post("/api/imports/check", opts, async (req) => {
    const body = importSchema.parse(req.body);
    return previewImport(db, req.user!.id, body);
  });

  app.post("/api/imports/commit", opts, async (req, reply) => {
    const body = importSchema.parse(req.body);
    const result = await commitImport(db, req.user!.id, body);
    settleLater(req.user!.id);
    reply.code(201).send(result);
  });

  // Drop-anything import, step 1: identify one file with no hints and preview it. Writes nothing.
  app.post("/api/imports/detect", opts, async (req) => {
    const body = uploadSchema.parse(req.body);
    return { detection: await detectUpload(db, req.user!.id, body) };
  });

  // Step 2: commit a whole drop (several files, new accounts included) in one transaction.
  app.post("/api/imports/commit-many", opts, async (req, reply) => {
    const body = commitManySchema.parse(req.body);
    const result = await commitMany(db, req.user!.id, body.items);
    settleLater(req.user!.id);
    reply.code(201).send(result);
  });

  // Price-only seed from a holdings snapshot (e.g. Dhan "Holding" — a closing price, no cost basis).
  app.post("/api/imports/seed-prices", opts, async (req) => {
    const body = seedPricesSchema.parse(req.body);
    return seedPricesFromHoldings(db, req.user!.id, body);
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
