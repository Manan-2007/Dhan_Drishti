import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createDb } from "./db/index.js";
import { buildApp } from "./app.js";
import { env } from "./env.js";
import { CompositeProvider } from "./market/composite.js";
import { YahooProvider } from "./market/providers/yahoo.js";
import { AmfiProvider } from "./market/providers/amfi.js";
import { DerivativeEstimateProvider } from "./market/providers/derivative-estimate.js";
import { FrankfurterProvider } from "./market/providers/frankfurter.js";
import { YahooBenchmarkProvider } from "./market/providers/yahoo-benchmark.js";
import { startScheduler } from "./jobs/scheduler.js";
import { convertLegacyStatements } from "./import/snapshot.js";

/** Resolve the web build dir: WEB_DIR env, else the sibling apps/web/dist if present. */
function resolveWebDir(): string {
  if (env.webDir) return env.webDir;
  const guess = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  return existsSync(guess) ? guess : "";
}

async function main() {
  const { db } = await createDb(env.databaseUrl);
  // One-time: holdings statements imported as buys become snapshots (see import/snapshot.ts).
  const converted = await convertLegacyStatements(db);
  // eslint-disable-next-line no-console
  if (converted) console.log(`Converted ${converted} holdings-statement rows into snapshots`);
  // Share one market provider between the app and the background scheduler.
  const marketProvider = new CompositeProvider(new YahooProvider(), new AmfiProvider(), new DerivativeEstimateProvider());
  const fxProvider = new FrankfurterProvider();
  const benchmarkProvider = new YahooBenchmarkProvider();
  const app = buildApp(db, { webDir: resolveWebDir(), marketProvider, fxProvider, benchmarkProvider, settleExpiries: true });
  const addr = await app.listen({ port: env.port, host: env.host });
  // Nightly-ish price refresh + net-worth snapshots (only in the real server, never in tests).
  startScheduler(db, marketProvider, { fx: fxProvider, index: benchmarkProvider });
  // eslint-disable-next-line no-console
  console.log(`Dhan Drishti server listening on ${addr}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
