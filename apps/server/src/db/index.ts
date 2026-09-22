import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

export type DB = LibSQLDatabase<typeof schema>;
/** The transaction handle drizzle passes to `db.transaction(async (tx) => …)`. */
export type DbTransaction = Parameters<Parameters<DB["transaction"]>[0]>[0];
/** Anything you can run queries against — the base connection or a transaction. Helpers that must
 *  work inside or outside a transaction take this so a caller can pass either. */
export type Database = DB | DbTransaction;

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

// Throwaway temp DBs stood up for ":memory:" (see toLibsqlUrl) — cleaned up when the process exits.
const tempDbs: string[] = [];
let cleanupRegistered = false;

/** libsql URL: ':memory:' → a unique temp file; otherwise a file path → file: URL. */
function toLibsqlUrl(url: string): string {
  if (url === ":memory:") {
    // @libsql/client's real `:memory:` is connection-scoped: `client.transaction()` opens a fresh
    // (empty) connection, so any transaction wipes the in-memory tables. Tests need working
    // transactions, so back an in-memory request with a unique throwaway temp file instead,
    // deleted on process exit. (Production always passes a real file path, never ":memory:".)
    const abs = join(tmpdir(), `dd-mem-${randomUUID()}.sqlite`);
    tempDbs.push(abs);
    if (!cleanupRegistered) {
      cleanupRegistered = true;
      process.once("exit", () => {
        for (const p of tempDbs) for (const f of [p, `${p}-wal`, `${p}-shm`]) try { rmSync(f); } catch { /* best effort */ }
      });
    }
    return `file:${abs}`;
  }
  if (url.startsWith("file:") || url.startsWith("libsql:") || url.startsWith("http")) return url;
  const abs = isAbsolute(url) ? url : resolve(process.cwd(), url);
  const dir = dirname(abs);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  return `file:${abs}`;
}

/** Open a libsql database, set pragmas, run migrations. */
export async function createDb(url: string): Promise<{ db: DB; client: Client }> {
  const client = createClient({ url: toLibsqlUrl(url) });
  await client.execute("PRAGMA foreign_keys = ON;");
  // WAL lets a reader and the background scheduler's writer proceed concurrently without blocking
  // each other; busy_timeout makes a brief lock wait instead of failing with SQLITE_BUSY. Both are
  // no-ops on the (unused) pure-memory path and harmless on the file DB used in prod and tests.
  await client.execute("PRAGMA journal_mode = WAL;").catch(() => undefined);
  await client.execute("PRAGMA busy_timeout = 5000;").catch(() => undefined);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db, client };
}

export { schema };
