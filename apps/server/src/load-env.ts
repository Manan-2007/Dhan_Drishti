/**
 * Reads apps/server/.env (git-ignored) into the environment before anything else is loaded —
 * where the Azure OpenAI key lives. Imported first by server.ts. A missing file is fine.
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const file = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
if (existsSync(file)) process.loadEnvFile(file);
