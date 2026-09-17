import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { DB } from "../db/index.js";
import { users, portfolios, accounts, transactions, importBatches, securities } from "../db/schema.js";
import { authed } from "../lib/routes.js";
import { AppError } from "../lib/errors.js";
import { verifyPassword } from "../auth/passwords.js";
import { SESSION_COOKIE } from "../auth/service.js";

/** Full export of a user's own data (data ownership / portability — privacy principle). */
export async function exportUserData(db: DB, userId: string) {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  const ports = await db.select().from(portfolios).where(eq(portfolios.userId, userId)).all();
  const accs = await db.select().from(accounts).where(eq(accounts.userId, userId)).all();
  const txs = await db.select().from(transactions).where(eq(transactions.userId, userId)).all();
  const imports = await db.select().from(importBatches).where(eq(importBatches.userId, userId)).all();
  const secIds = [...new Set(txs.map((t) => t.securityId).filter((x): x is string => !!x))];
  const secs = secIds.length ? await db.select().from(securities).where(inArray(securities.id, secIds)).all() : [];

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    user: user ? { id: user.id, username: user.username, email: user.email, baseCurrency: user.baseCurrency, createdAt: user.createdAt } : null,
    portfolios: ports,
    accounts: accs,
    securities: secs, // referenced reference data (shared master)
    transactions: txs,
    imports,
  };
}

const deleteSchema = z.object({ password: z.string().min(1) });

export function registerAccountManagementRoutes(app: FastifyInstance, db: DB): void {
  const opts = authed(app);

  app.get("/api/account/export", opts, async (req, reply) => {
    const data = await exportUserData(db, req.user!.id);
    reply.header("content-disposition", `attachment; filename="dhan-drishti-export-${Date.now()}.json"`);
    reply.send(data);
  });

  // Permanently delete the account and all owned data. Requires the current password.
  app.post("/api/account/delete", opts, async (req, reply) => {
    const { password } = deleteSchema.parse(req.body);
    const user = req.user!;
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) throw new AppError(401, "invalid_password", "Password is incorrect");
    // FKs cascade from users → portfolios/accounts/transactions/imports/sessions.
    await db.delete(users).where(eq(users.id, user.id)).run();
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.send({ ok: true });
  });
}
