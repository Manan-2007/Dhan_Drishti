/**
 * Generate the bundled NSE listing master: symbol, name and ISIN for every listed share, ETF and
 * the listed REITs/InvITs. Lets the importer turn a broker's name-only row ("POWER FINANCE
 * CORPORATION", Dhan's export) into a real ticker and ISIN offline.
 *
 *   node apps/server/scripts/build-nse-master.mjs [EQUITY_L.csv] [eq_etfseclist.csv]
 *
 * With no arguments it downloads both public files from nsearchives.nseindia.com. The output is
 * src/import/nse-master-data.json — public exchange reference data, safe to commit.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";

const OUT = fileURLToPath(new URL("../src/import/nse-master-data.json", import.meta.url));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

async function load(pathOrUrl) {
  if (!pathOrUrl.startsWith("http")) return readFileSync(pathOrUrl, "utf8");
  const res = await fetch(pathOrUrl, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${pathOrUrl}: HTTP ${res.status}`);
  return res.text();
}
const rows = (text) => Papa.parse(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() }).data;
const s = (v) => String(v ?? "").trim();

// Fund houses as NSE abbreviates them in an ETF's security name ("MOTILALAMC-MOMENTUM50").
const ISSUERS = [
  [/^MIRAE/i, "Mirae Asset"],
  [/^MOTILAL/i, "Motilal Oswal"],
  [/^ICICIPR/i, "ICICI Prudential"],
  [/^GROWW/i, "Groww"],
  [/^DSP/i, "DSP"],
  [/^HDFC/i, "HDFC"],
  [/^KOTAK/i, "Kotak Mahindra"],
  [/^EDEL/i, "Edelweiss"],
  [/^UTI/i, "UTI"],
  [/^SBI/i, "SBI"],
  [/^(BIRLASL|ABSL)/i, "Aditya Birla Sun Life"],
  [/^AXIS/i, "Axis"],
  [/^ZERODHA/i, "Zerodha"],
  [/^(NIPPON|NIPIND|NIP IND|RELCAP)/i, "Nippon India"],
  [/^AONE/i, "Angel One"],
  [/^LIC/i, "LIC"],
  [/^BANDHAN/i, "Bandhan"],
  [/^360ONE/i, "360 ONE"],
  [/^(RELIGAR|INVESCO)/i, "Invesco"],
  [/^TATA/i, "Tata"],
  [/^BARODABNP/i, "Baroda BNP Paribas"],
  [/^BFAM/i, "Bajaj Finserv"],
  [/^SHRIRAM/i, "Shriram"],
  [/^UNION/i, "Union"],
  [/^CHOICE/i, "Choice"],
  [/^HSBC/i, "HSBC"],
  [/^JIOBLACKROCK/i, "Jio BlackRock"],
  [/^QUANTUM/i, "Quantum"],
  [/^QUANT/i, "Quant"],
  [/^WEALTH/i, "The Wealth Company"],
];
const issuerOf = (securityName) => ISSUERS.find(([re]) => re.test(securityName.replace(/\s+/g, "")))?.[1] ?? "";

// Listed REITs and InvITs aren't in either file. Symbols only; the ISIN comes from the broker row.
const TRUSTS = [
  ["EMBASSY", "Embassy Office Parks REIT"],
  ["MINDSPACE", "Mindspace Business Parks REIT"],
  ["BIRET", "Brookfield India Real Estate Trust REIT"],
  ["NXST", "Nexus Select Trust REIT"],
  ["PGINVIT", "PowerGrid Infrastructure Investment Trust InvIT"],
  ["INDIGRID", "India Grid Trust InvIT"],
  ["IRBINVIT", "IRB InvIT Fund"],
];

const [eqSrc = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv", etfSrc = "https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv"] = process.argv.slice(2);

const out = [];
for (const r of rows(await load(eqSrc))) {
  const symbol = s(r.SYMBOL);
  if (symbol) out.push([symbol, s(r["NAME OF COMPANY"]), s(r["ISIN NUMBER"]), "equity"]);
}
for (const r of rows(await load(etfSrc))) {
  const symbol = s(r.Symbol);
  if (!symbol) continue;
  const underlying = s(r["Underlying Asset"]);
  const issuer = issuerOf(s(r.SecurityName));
  const lower = underlying.toLowerCase();
  const name = [issuer && !lower.includes(issuer.split(" ")[0].toLowerCase()) ? issuer : "", underlying, /\betf\b|exchange traded/i.test(underlying) ? "" : "ETF"].filter(Boolean).join(" ");
  out.push([symbol, name, s(r.ISINNumber), "etf"]);
}
for (const [symbol, name] of TRUSTS) out.push([symbol, name, "", "reit_invit"]);

out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`wrote ${out.length} listings to ${OUT}`);
