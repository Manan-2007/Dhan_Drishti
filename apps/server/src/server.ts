import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createDb } from "./db/index.js";
import { buildApp } from "./app.js";
import { env } from "./env.js";

/** Resolve the web build dir: WEB_DIR env, else the sibling apps/web/dist if present. */
function resolveWebDir(): string {
  if (env.webDir) return env.webDir;
  const guess = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  return existsSync(guess) ? guess : "";
}

async function main() {
  const { db } = await createDb(env.databaseUrl);
  const app = buildApp(db, { webDir: resolveWebDir() });
  const addr = await app.listen({ port: env.port, host: env.host });
  // eslint-disable-next-line no-console
  console.log(`Dhan Drishti server listening on ${addr}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
