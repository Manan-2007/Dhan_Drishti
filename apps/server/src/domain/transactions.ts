import { randomUUID } from "node:crypto";
import { and, eq, gte, lte, desc, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { TX_TYPES, SEGMENTS, QTY_AFFECTING, d } from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { transactions, securities, accounts, type Transaction } from "../db/schema.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { authed } from "../lib/routes.js";
import type { FxProvider } from "../market/types.js";
import { baseCurrencyOf, fxAtCost } from "../market/fx.js";
import { getPortfolioOwned } from "./portfolios.js";

const decimalStr = z
  .string()
  .trim()
  .refine((s) => s !== "" && Number.isFinite(Number(s)), "must be a numeric string");

// Accepts a date-only or full ISO timestamp; normalizes to ISO-8601 UTC.
const dateStr = z
  .string()
  .trim()
  .refine((s) => !Number.isNaN(Date.parse(s)), "invalid date")
  .transform((s) => new Date(s).toISOString());

const createSchema = z.object({
  portfolioId: z.string().min(1),
  accountId: z.string().min(1).nullable().optional(),
  securityId: z.string().min(1).nullable().optional(),
  type: z.enum(TX_TYPES),
  tradeDate: dateStr,
  settleDate: dateStr.nullable().optional(),
  quantity: decimalStr.optional(),
  price: decimalStr.optional(),
  grossAmount: decimalStr.optional(),
  fees: decimalStr.optional(),
  taxes: decimalStr.optional(),
  currency: z.string().trim().length(3).toUpperCase().default("INR"),
  fxRateToBase: decimalStr.nullable().optional(),
  segment: z.enum(SEGMENTS).default("equity"),
  externalRef: z.string().max(200).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});
const updateSchema = createSchema.partial().omit({ portfolioId: true });

const searchSchema = z.object({
  portfolioId: z.string().optional(),
  accountId: z.string().optional(),
  securityId: z.string().optional(),
  type: z.enum(TX_TYPES).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

async function getTxOwned(db: DB, userId: string, id: string): Promise<Transaction> {
  const row = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
    .get();
  if (!row) throw new NotFoundError("Transaction");
  return row;
}

/** Validate cross-entity ownership and per-type invariants; returns computed grossAmount. */
async function validateAndBuild(
  db: DB,
  userId: string,
  input: z.infer<typeof createSchema>,
): Promise<Record<string, unknown>> {
  await getPortfolioOwned(db, userId, input.portfolioId);

  if (input.accountId) {
    const acc = await db
      .select({ id: accounts.id, portfolioId: accounts.portfolioId })
      .from(accounts)
      .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, userId)))
      .get();
    if (!acc) throw new NotFoundError("Account");
    if (acc.portfolioId !== input.portfolioId)
      throw new BadRequestError("account_portfolio_mismatch", "Account does not belong to that portfolio");
  }

  if (input.securityId) {
    const sec = await db.select({ id: securities.id }).from(securities).where(eq(securities.id, input.securityId)).get();
    if (!sec) throw new NotFoundError("Security");
  }

  const isQtyType = QTY_AFFECTING.has(input.type);
  if (isQtyType && !input.securityId)
    throw new BadRequestError("security_required", `Transaction type '${input.type}' requires a security`);
  if (input.type === "dividend" && !input.securityId)
    throw new BadRequestError("security_required", "Dividend requires a security");

  const qty = input.quantity ?? "0";
  const price = input.price ?? "0";
  if (isQtyType && !d(qty).greaterThan(0))
    throw new BadRequestError("quantity_required", `Transaction type '${input.type}' requires quantity > 0`);

  // A split carries its ratio (new shares per old share) in `price`, not a quantity.
  if (input.type === "split") {
    if (!input.securityId) throw new BadRequestError("security_required", "Split requires a security");
    if (!d(price).greaterThan(0))
      throw new BadRequestError("split_ratio_required", "Split requires price = ratio (new shares per old share) > 0");
  }

  // Derive grossAmount for trades when not supplied (qty * price).
  const grossAmount =
    input.grossAmount ?? (isQtyType ? d(qty).times(d(price)).toFixed() : "0");

  return {
    id: randomUUID(),
    userId,
    portfolioId: input.portfolioId,
    accountId: input.accountId ?? null,
    securityId: input.securityId ?? null,
    type: input.type,
    tradeDate: input.tradeDate,
    settleDate: input.settleDate ?? null,
    quantity: qty,
    price,
    grossAmount,
    fees: input.fees ?? "0",
    taxes: input.taxes ?? "0",
    currency: input.currency,
    fxRateToBase: input.fxRateToBase ?? null,
    segment: input.segment,
    externalRef: input.externalRef ?? null,
    notes: input.notes ?? null,
    sourceBroker: "manual",
  };
}

export function registerTransactionRoutes(app: FastifyInstance, db: DB, fxProvider?: FxProvider): void {
  const opts = authed(app);

  // Best-effort: stamp a foreign-currency trade with its FX-at-cost (rate on the trade date)
  // so returns can later be split into asset vs currency. Never blocks the write.
  async function withFxAtCost(userId: string, row: Record<string, unknown>): Promise<void> {
    if (!fxProvider) return;
    const currency = row.currency as string;
    if (!currency || (row.fxRateToBase != null && row.fxRateToBase !== "")) return;
    const base = await baseCurrencyOf(db, userId);
    if (currency === base) return;
    row.fxRateToBase = await fxAtCost(fxProvider, currency, base, row.tradeDate as string);
  }

  app.get("/api/transactions", opts, async (req) => {
    const q = searchSchema.parse(req.query);
    const userId = req.user!.id;
    const clauses = [eq(transactions.userId, userId)];
    if (q.portfolioId) clauses.push(eq(transactions.portfolioId, q.portfolioId));
    if (q.accountId) clauses.push(eq(transactions.accountId, q.accountId));
    if (q.securityId) clauses.push(eq(transactions.securityId, q.securityId));
    if (q.type) clauses.push(eq(transactions.type, q.type));
    if (q.from) clauses.push(gte(transactions.tradeDate, new Date(q.from).toISOString()));
    if (q.to) clauses.push(lte(transactions.tradeDate, new Date(q.to).toISOString()));
    const where = and(...clauses);

    const rows = await db
      .select()
      .from(transactions)
      .where(where)
      .orderBy(desc(transactions.tradeDate), desc(transactions.createdAt))
      .limit(q.limit)
      .offset(q.offset)
      .all();
    const countRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(where)
      .all();
    const total = countRows[0]?.count ?? 0;

    // Enrich with the security and account each row refers to — a raw securityId/accountId
    // tells you nothing about what was actually bought or sold. Follows the ledger's own
    // fetch-then-map pattern (see holdings.ts) rather than a SQL join.
    const secIds = [...new Set(rows.map((r) => r.securityId).filter((x): x is string => !!x))];
    const acctIds = [...new Set(rows.map((r) => r.accountId).filter((x): x is string => !!x))];
    const [secRows, acctRows] = await Promise.all([
      secIds.length ? db.select().from(securities).where(inArray(securities.id, secIds)).all() : Promise.resolve([]),
      acctIds.length ? db.select().from(accounts).where(inArray(accounts.id, acctIds)).all() : Promise.resolve([]),
    ]);
    const secById = new Map(secRows.map((s) => [s.id, s]));
    const acctById = new Map(acctRows.map((a) => [a.id, a]));

    const enriched = rows.map((t) => ({
      ...t,
      security: t.securityId
        ? (() => {
            const s = secById.get(t.securityId!);
            return s ? { id: s.id, symbol: s.symbol, name: s.name, isin: s.isin, assetClass: s.assetClass, sector: s.sector, exchange: s.exchange } : null;
          })()
        : null,
      account: t.accountId
        ? (() => {
            const a = acctById.get(t.accountId!);
            return a ? { id: a.id, name: a.name, broker: a.broker } : null;
          })()
        : null,
    }));

    return { transactions: enriched, total, limit: q.limit, offset: q.offset };
  });

  app.post("/api/transactions", opts, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const userId = req.user!.id;
    const row = await validateAndBuild(db, userId, body);
    await withFxAtCost(userId, row);
    await db.insert(transactions).values(row as typeof transactions.$inferInsert).run();
    reply.code(201).send({ transaction: await getTxOwned(db, userId, row.id as string) });
  });

  app.get("/api/transactions/:id", opts, async (req) => {
    const { id } = req.params as { id: string };
    return { transaction: await getTxOwned(db, req.user!.id, id) };
  });

  app.put("/api/transactions/:id", opts, async (req) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    const existing = await getTxOwned(db, userId, id);
    const patch = updateSchema.parse(req.body);
    // Re-validate the merged result so invariants still hold.
    const merged = { ...existing, ...patch, portfolioId: existing.portfolioId } as z.infer<typeof createSchema>;
    const rebuilt = await validateAndBuild(db, userId, merged);
    delete (rebuilt as Record<string, unknown>).id;
    delete (rebuilt as Record<string, unknown>).userId;
    await db
      .update(transactions)
      .set(rebuilt)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
      .run();
    return { transaction: await getTxOwned(db, userId, id) };
  });

  app.delete("/api/transactions/:id", opts, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    await getTxOwned(db, userId, id);
    await db.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId))).run();
    reply.send({ ok: true });
  });
}
