import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

export type DB = LibSQLDatabase<typeof schema>;

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

/** libsql URL: ':memory:' → in-memory; otherwise a file path → file: URL. */
function toLibsqlUrl(url: string): string {
  if (url === ":memory:") return ":memory:";
  if (url.startsWith("file:") || url.startsWith("libsql:") || url.startsWith("http")) return url;
  const abs = isAbsolute(url) ? url : resolve(process.cwd(), url);
  const dir = dirname(abs);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  return `file:${abs}`;
}

/** Open a libsql database, enable foreign keys, run migrations. */
export async function createDb(url: string): Promise<{ db: DB; client: Client }> {
  const client = createClient({ url: toLibsqlUrl(url) });
  await client.execute("PRAGMA foreign_keys = ON;");
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db, client };
}

export { schema };
