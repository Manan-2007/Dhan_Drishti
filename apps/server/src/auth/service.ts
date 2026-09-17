import { randomUUID, randomBytes } from "node:crypto";
import { eq, and, gt } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { users, sessions, type User } from "../db/schema.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { AppError } from "../lib/errors.js";

export const SESSION_COOKIE = "dd_session";

export interface PublicUser {
  id: string;
  username: string;
  email: string | null;
  baseCurrency: string;
}

export function toPublicUser(u: User): PublicUser {
  return { id: u.id, username: u.username, email: u.email, baseCurrency: u.baseCurrency };
}

function isoInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export class AuthError extends AppError {}

export async function registerUser(
  db: DB,
  input: { username: string; password: string; email?: string; baseCurrency?: string },
): Promise<User> {
  const existing = await db.select().from(users).where(eq(users.username, input.username)).get();
  if (existing) throw new AuthError(409, "username_taken", "Username is already taken");

  const passwordHash = await hashPassword(input.password);
  const row = {
    id: randomUUID(),
    username: input.username,
    email: input.email ?? null,
    passwordHash,
    baseCurrency: input.baseCurrency ?? "INR",
  };
  await db.insert(users).values(row).run();
  return (await db.select().from(users).where(eq(users.id, row.id)).get())!;
}

// Constant dummy hash so login timing doesn't reveal whether a username exists.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG";

export async function authenticate(db: DB, username: string, password: string): Promise<User> {
  const user = await db.select().from(users).where(eq(users.username, username)).get();
  const ok = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, password);
  if (!user || !ok) throw new AuthError(401, "invalid_credentials", "Invalid username or password");
  return user;
}

export async function createSession(db: DB, userId: string, ttlDays: number): Promise<string> {
  const id = randomBytes(32).toString("hex");
  await db.insert(sessions).values({ id, userId, expiresAt: isoInDays(ttlDays) }).run();
  return id;
}

export async function getSessionUser(db: DB, sessionId: string): Promise<User | null> {
  const nowIso = new Date().toISOString();
  const session = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, nowIso)))
    .get();
  if (!session) return null;
  return (await db.select().from(users).where(eq(users.id, session.userId)).get()) ?? null;
}

export async function destroySession(db: DB, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}
