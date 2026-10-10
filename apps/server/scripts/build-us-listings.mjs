/**
 * Generate the bundled US listings reference from Nasdaq's public screener (no key):
 *
 *   node apps/server/scripts/build-us-listings.mjs
 *
 * Every NASDAQ / NYSE / NYSE American stock with its name, sector and industry, and every US ETF
 * with its name, written to src/import/us-listings-data.json. It's public exchange reference data,
 * safe to commit; re-run it now and then to pick up new listings. US holdings are classified from
 * it the way Indian ones are from the NSE reference (see us-listings.ts).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../src/import/us-listings-data.json", import.meta.url));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** "NVIDIA Corporation Common Stock" → "NVIDIA Corporation": drop the share-class boilerplate. */
const cleanName = (n) =>
  String(n ?? "")
    .replace(/\s+(Class [A-Z]\s+)?(Common Stock|Capital Stock|Ordinary Shares?|Common Shares?|Subordinate Voting Shares|American Depositary Shares?|New York Registry Shares?|Depositary Shares?)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

const stocks = (await get("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=20000&download=true")).data.rows;
const etfsRaw = await get("https://api.nasdaq.com/api/screener/etf?tableonly=true&limit=20000&download=true");
const etfs = etfsRaw.data?.data?.rows ?? etfsRaw.data?.rows ?? [];

const s = {};
for (const r of stocks) {
  const sym = String(r.symbol ?? "").trim().toUpperCase();
  if (!sym || !r.sector) continue; // no sector: nothing to classify by
  s[sym] = [cleanName(r.name), String(r.sector).trim(), String(r.industry ?? "").trim()];
}
const e = {};
for (const r of etfs) {
  const sym = String(r.symbol ?? "").trim().toUpperCase();
  if (sym && r.companyName) e[sym] = String(r.companyName).replace(/\s+/g, " ").trim();
}

const asOf = new Date().toISOString().slice(0, 10);
writeFileSync(OUT, JSON.stringify({ source: "Nasdaq stock & ETF screeners", asOf, stocks: s, etfs: e }));
console.log(`Wrote ${Object.keys(s).length} stocks and ${Object.keys(e).length} ETFs (as of ${asOf}) → ${OUT}`);
