import { randomUUID } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { DB } from "../db/index.js";
import { accounts, type Account } from "../db/schema.js";
import { NotFoundError } from "../lib/errors.js";
import { authed } from "../lib/routes.js";
import { getPortfolioOwned } from "./portfolios.js";

export const BROKERS = ["zerodha", "dhan", "vested", "ibkr", "binance", "crypto", "generic", "manual"] as const;

const createSchema = z.object({
  portfolioId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  broker: z.enum(BROKERS).default("manual"),
  accountRef: z.string().max(200).optional(),
  currency: z.string().trim().length(3).toUpperCase().default("INR"),
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  broker: z.enum(BROKERS).optional(),
  accountRef: z.string().max(200).nullable().optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
});

async function getAccountOwned(db: DB, userId: string, id: string): Promise<Account> {
  const row = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
    .get();
  if (!row) throw new NotFoundError("Account");
  return row;
}

export function registerAccountRoutes(app: FastifyInstance, db: DB): void {
  const opts = authed(app);

  app.get("/api/accounts", opts, async (req) => {
    const { portfolioId } = req.query as { portfolioId?: string };
    const userId = req.user!.id;
    const where = portfolioId
      ? and(eq(accounts.userId, userId), eq(accounts.portfolioId, portfolioId))
      : eq(accounts.userId, userId);
    return { accounts: await db.select().from(accounts).where(where).orderBy(desc(accounts.createdAt)).all() };
  });

  app.post("/api/accounts", opts, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const userId = req.user!.id;
    await getPortfolioOwned(db, userId, body.portfolioId); // portfolio must belong to user
    const row = {
      id: randomUUID(),
      userId,
      portfolioId: body.portfolioId,
      name: body.name,
      broker: body.broker,
      accountRef: body.accountRef ?? null,
      currency: body.currency,
    };
    await db.insert(accounts).values(row).run();
    reply.code(201).send({ account: await getAccountOwned(db, userId, row.id) });
  });

  app.get("/api/accounts/:id", opts, async (req) => {
    const { id } = req.params as { id: string };
    return { account: await getAccountOwned(db, req.user!.id, id) };
  });

  app.put("/api/accounts/:id", opts, async (req) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    const body = updateSchema.parse(req.body);
    await getAccountOwned(db, userId, id);
    await db
      .update(accounts)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
      .run();
    return { account: await getAccountOwned(db, userId, id) };
  });

  app.delete("/api/accounts/:id", opts, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    await getAccountOwned(db, userId, id);
    await db.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, userId))).run();
    reply.send({ ok: true });
  });
}
