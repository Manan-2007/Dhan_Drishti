import { randomUUID } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { DB } from "../db/index.js";
import { portfolios, type Portfolio } from "../db/schema.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { authed } from "../lib/routes.js";

export const PORTFOLIO_KINDS = [
  "broker",
  "group",
  "strategy",
  "geo",
  "goal",
  "family",
  "custom",
] as const;

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional(),
  kind: z.enum(PORTFOLIO_KINDS).default("custom"),
  baseCurrency: z.string().trim().length(3).toUpperCase().default("INR"),
});
const updateSchema = createSchema.partial();

export async function listPortfolios(db: DB, userId: string): Promise<Portfolio[]> {
  return db
    .select()
    .from(portfolios)
    .where(eq(portfolios.userId, userId))
    .orderBy(desc(portfolios.createdAt))
    .all();
}

export async function getPortfolioOwned(db: DB, userId: string, id: string): Promise<Portfolio> {
  const row = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)))
    .get();
  if (!row) throw new NotFoundError("Portfolio");
  return row;
}

export function registerPortfolioRoutes(app: FastifyInstance, db: DB): void {
  const opts = authed(app);

  app.get("/api/portfolios", opts, async (req) => {
    return { portfolios: await listPortfolios(db, req.user!.id) };
  });

  app.post("/api/portfolios", opts, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const userId = req.user!.id;
    const dup = await db
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(and(eq(portfolios.userId, userId), eq(portfolios.name, body.name)))
      .get();
    if (dup) throw new ConflictError("portfolio_name_taken", "A portfolio with that name already exists");

    const row = { id: randomUUID(), userId, ...body, description: body.description ?? null };
    await db.insert(portfolios).values(row).run();
    reply.code(201).send({ portfolio: await getPortfolioOwned(db, userId, row.id) });
  });

  app.get("/api/portfolios/:id", opts, async (req) => {
    const { id } = req.params as { id: string };
    return { portfolio: await getPortfolioOwned(db, req.user!.id, id) };
  });

  app.put("/api/portfolios/:id", opts, async (req) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    const body = updateSchema.parse(req.body);
    await getPortfolioOwned(db, userId, id); // ownership + existence
    await db
      .update(portfolios)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)))
      .run();
    return { portfolio: await getPortfolioOwned(db, userId, id) };
  });

  app.delete("/api/portfolios/:id", opts, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    await getPortfolioOwned(db, userId, id);
    await db.delete(portfolios).where(and(eq(portfolios.id, id), eq(portfolios.userId, userId))).run();
    reply.send({ ok: true });
  });
}
