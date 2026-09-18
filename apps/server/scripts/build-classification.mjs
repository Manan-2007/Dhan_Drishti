/**
 * Generate the bundled instrument-classification dataset from an NSE / AMFI reference workbook.
 *
 *   node apps/server/scripts/build-classification.mjs <reference.xlsx> [out.ts]
 *
 * The workbook has one row per instrument (sheets: "NSE Eq", "NSE ETFs", "BSE Eq", "MF Keys")
 * carrying AssetClass / SubClass / Sector / SubSector. We emit a compact ticker→class and
 * fund-name→class map so the app classifies sectors and sub-sectors automatically. The reference
 * workbook itself is never committed; only this derived public-market taxonomy is.
 */
import * as XLSX from "xlsx";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = process.argv[2];
const out = process.argv[3] ?? fileURLToPath(new URL("../src/import/classification-data.ts", import.meta.url));
if (!src) {
  console.error("usage: build-classification.mjs <reference.xlsx> [out.ts]");
  process.exit(1);
}
const wb = XLSX.read(readFileSync(src));
const rows = (n) => (wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: "" }) : []);
const s = (v) => String(v ?? "").trim();

// Excel AssetClass/SubClass → app AssetClass enum (equity/etf/mf/bond/reit_invit/sgb/crypto/cash/other).
function mapAsset(assetClass, subClass) {
  const sc = s(subClass), ac = s(assetClass);
  if (/Eq_Stocks/i.test(sc)) return "equity";
  if (/ETF/i.test(sc)) return "etf";
  if (/^MF_/i.test(sc)) return "mf";
  if (sc === "REIT" || sc === "InVIT" || ac === "InvIT_REIT") return "reit_invit";
  if (ac === "Debt" || ac === "FD/Bonds") return "bond";
  if (ac === "Cash") return "cash";
  if (ac === "Crypto") return "crypto";
  if (ac === "Gold" || ac === "Silver") return "etf";
  return "equity";
}

// Normalize a fund name so a broker's "AXIS SMALL CAP FUND - DIRECT PLAN" matches "Axis Small Cap Fund".
export function normFund(name) {
  return s(name)
    .toUpperCase()
    .replace(/\b(DIRECT|REGULAR|PLAN|GROWTH|IDCW|DIVIDEND|PAYOUT|REINVEST|OPTION|FUND|SCHEME)\b/g, " ")
    .replace(/[^A-Z0-9]/g, "");
}

const ticker = {};
const put = (map, key, cls) => { const k = s(key).toUpperCase(); if (k && !map[k]) map[k] = cls; };
for (const r of rows("NSE Eq")) put(ticker, r.Ticker, [mapAsset(r.AssetClass, r.SubClass), s(r.Sector), s(r.SubSector)]);
for (const r of rows("NSE ETFs")) put(ticker, r.Ticker, [mapAsset(r.AssetClass, r.SubClass), s(r.Sector), s(r.ETF_SubSector)]);
for (const r of rows("BSE Eq")) put(ticker, r["NSE Ticker"], [mapAsset(r.AssetClass, r.SubClass), s(r.Sector), s(r.SubSector)]);

const fund = {};
for (const r of rows("MF Keys")) {
  const cls = [mapAsset(r.AssetClass, r.SubClass), s(r.Sector), s(r.SubSector)];
  for (const key of [r["AMFI Name"], r["MF Name (Broker)"], r["MF NickName"]]) { const k = normFund(key); if (k && !fund[k]) fund[k] = cls; }
}

const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const lit = (o) => Object.entries(o).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n");

const body = `// AUTO-GENERATED — do not edit by hand. Regenerate with apps/server/scripts/build-classification.mjs.
// Public NSE / AMFI sector taxonomy: ticker or fund name → [assetClass, sector, subSector].
import type { AssetClass } from "@dhan-drishti/core";

export type RefClass = [AssetClass, string, string];

/** Normalize a fund name so a broker export matches the reference (strip plan/option/legal words). */
export function normFund(name: string): string {
  return (name ?? "")
    .toUpperCase()
    .replace(/\\b(DIRECT|REGULAR|PLAN|GROWTH|IDCW|DIVIDEND|PAYOUT|REINVEST|OPTION|FUND|SCHEME)\\b/g, " ")
    .replace(/[^A-Z0-9]/g, "");
}

export const TICKER_CLASS: Record<string, RefClass> = {
${lit(sortObj(ticker))}
};

export const FUND_CLASS: Record<string, RefClass> = {
${lit(sortObj(fund))}
};
`;
writeFileSync(out, body);
console.log(`wrote ${out}: ${Object.keys(ticker).length} tickers, ${Object.keys(fund).length} funds`);
