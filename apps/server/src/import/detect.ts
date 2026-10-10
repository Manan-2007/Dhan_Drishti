import Papa from "papaparse";
import * as XLSX from "xlsx";
import { parseCsv } from "./csv.js";
import { looksLikeXlsx } from "./xlsx.js";
import { detectBest, brokerFamiliesOf } from "./registry.js";
import { identifyBrokerReport, reportIdentity } from "./broker-reports.js";
import type { ParsedCsv } from "./types.js";

/**
 * Work out what an uploaded file is WITHOUT the user telling us: which broker and export type,
 * whose account (the client code printed inside the file or in its name), and what to do with
 * it. Everything here runs locally; nothing about the file leaves the machine.
 */

export type FileKind =
  | "transactions" // trades, dividends, cash moves → the ledger
  | "prices" // a holdings snapshot with closing prices but no cost → quotes only
  | "pnl_report" // a broker's realised-P&L report → cross-checks the ledger, fills missing exits
  | "not_needed" // a report the app works out itself
  | "needs_password" // a protected CAS PDF
  | "unrecognized";

export interface FileSniff {
  kind: FileKind;
  /** Importer id for the transactions pipeline ("zerodha", "dhan-txn", "cas", …). */
  adapter: string | null;
  confidence: number;
  reason: string;
  /** Broker the account belongs to ("zerodha", "dhan", "vested", …), or null when the file can't say. */
  brokerFamily: string | null;
  /** Client code / account number read from the file or its name (e.g. BH8567, UCC BDDA88772). */
  accountRef: string | null;
  /** Account holder's name as printed in the file — shown locally to help pick whose account it is. */
  holderName: string | null;
  /** Workbook sheet the data came from, when the file is an Excel workbook. */
  sheet: string | null;
}

const FAMILY_WORDS: [RegExp, string][] = [
  [/zerodha|kite|console|coin/i, "zerodha"],
  // Zerodha names its Console exports "<report>-<client ID>": tradebook-PKY448-EQ, pnl-PKY448, taxpnl-PKY448-….
  [/(?:^|[-_ ])(?:tax)?pnl-[A-Z]{2,3}\d{3,5}(?=[-_ .]|$)|^(?:tradebook|holdings|ledger)-[A-Z]{2,3}\d{3,5}/i, "zerodha"],
  [/\bdhan\b|dhan[_-]/i, "dhan"],
  [/vested|drivewealth/i, "vested"],
  [/ibkr|interactive ?brokers/i, "ibkr"],
  [/binance/i, "binance"],
];

const REF_KEYS = ["ucc", "client id", "client code", "clientid", "drivewealth account number", "drivewealth acc no", "account number", "account no", "account id", "demat account"];
const HOLDER_KEYS = ["name", "client name", "account holder", "account holder name", "investor name"];

/** Up to the first 20 rows of each table, as trimmed cells — where brokers print account details. */
function preambleRows(text: string): string[][] {
  const head = text.split(/\r?\n/).slice(0, 20).join("\n");
  const parsed = Papa.parse<string[]>(head, { skipEmptyLines: "greedy" });
  return (parsed.data as string[][]).map((r) => r.map((c) => String(c ?? "").trim()).filter((c) => c !== ""));
}

/**
 * Read the client code and holder name, laid out either as "Key, Value" rows or as a header row
 * with the values in the row below it. Only these two fields are kept.
 */
function sniffKeyValues(rows: string[][]): { accountRef: string | null; holderName: string | null } {
  let accountRef: string | null = null;
  let holderName: string | null = null;
  const keyOf = (c: string) => c.toLowerCase().replace(/[:.]$/, "").trim();
  const okRef = (v: string) => /^[A-Z0-9-]{4,24}$/i.test(v);
  const okName = (v: string) => /^[\p{L} .'-]{2,60}$/u.test(v);
  rows.forEach((r, i) => {
    if (r.length >= 2 && r.length <= 3) {
      const key = keyOf(r[0]!);
      const value = r[1]!.trim();
      if (!accountRef && REF_KEYS.includes(key) && okRef(value)) accountRef = value.toUpperCase();
      if (!holderName && HOLDER_KEYS.includes(key) && okName(value)) holderName = value;
    }
    // Header row, values underneath (Vested: "Period, Name, PAN, DriveWealth Acc No").
    const below = rows[i + 1];
    if (below && r.length >= 2 && below.length === r.length) {
      r.forEach((h, j) => {
        const key = keyOf(h);
        const value = (below[j] ?? "").trim();
        if (!accountRef && REF_KEYS.includes(key) && okRef(value)) accountRef = value.toUpperCase();
        if (!holderName && HOLDER_KEYS.includes(key) && okName(value)) holderName = value;
      });
    }
  });
  return { accountRef, holderName };
}

/** Zerodha puts the client ID in its export names: "tradebook-BH8567-EQ.csv", "holdings-BH8567.xlsx". */
function refFromFilename(filename: string): string | null {
  const m = filename.match(/(?:^|[-_ ])([A-Z]{2,3}\d{3,5})(?=[-_ .]|$)/);
  return m ? m[1]! : null;
}

function familyFromText(text: string): string | null {
  for (const [re, fam] of FAMILY_WORDS) if (re.test(text)) return fam;
  return null;
}

/** Broker names that only appear in a file's own text when it really is theirs (no "coin"/"kite"). */
const TEXT_FAMILY_WORDS: [RegExp, string][] = [
  [/\bzerodha\b/i, "zerodha"],
  [/drivewealth|\bvested\b/i, "vested"],
  [/\bdhan\b/i, "dhan"],
  [/interactive brokers/i, "ibkr"],
  [/\bbinance\b/i, "binance"],
];
function familyFromContents(text: string): string | null {
  for (const [re, fam] of TEXT_FAMILY_WORDS) if (re.test(text)) return fam;
  return null;
}

const lower = (headers: string[]) => headers.map((h) => h.toLowerCase().trim());
const hasAll = (headers: string[], ...needles: string[]) => needles.every((n) => lower(headers).some((h) => h.includes(n)));

/** A realised-P&L summary (Dhan's "Realised PnL Report" and friends): derived data, not transactions. */
function isPnlReport(csv: ParsedCsv): boolean {
  const h = csv.headers;
  return (hasAll(h, "avg. buy price", "avg. sell price") || hasAll(h, "realised p&l") || hasAll(h, "realized p&l")) && !hasAll(h, "trade_date");
}

/** One we can check against: per-instrument quantity with its buy and sell values. */
const isCheckablePnl = (csv: ParsedCsv) => hasAll(csv.headers, "quantity", "buy value", "sell value");

/** A holdings snapshot with a closing price but no cost basis (Dhan "Holding summary"). */
function isPriceSnapshot(csv: ParsedCsv): boolean {
  const h = csv.headers;
  const hasPrice = hasAll(h, "closing price") || hasAll(h, "ltp") || hasAll(h, "last traded price");
  const hasCost = hasAll(h, "avg") || hasAll(h, "average") || hasAll(h, "buy value") || hasAll(h, "invested");
  const looksLikeHoldings = hasAll(h, "free holding") || hasAll(h, "valuation") || hasAll(h, "quantity") || hasAll(h, "qty");
  return hasPrice && looksLikeHoldings && !hasCost;
}

interface Table {
  sheet: string | null;
  csv: ParsedCsv;
}

function tablesOf(buf: Buffer, filename: string, encoding?: "base64"): { tables: Table[]; preamble: string[][] } {
  if (encoding === "base64" && looksLikeXlsx(buf, filename)) {
    const wb = XLSX.read(buf, { type: "buffer" });
    const tables: Table[] = [];
    const preamble: string[][] = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const text = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
      preamble.push(...preambleRows(text));
      const csv = parseCsv(text);
      if (csv.rows.length > 0) tables.push({ sheet: name, csv });
    }
    return { tables, preamble };
  }
  const text = buf.toString("utf8").replace(/^﻿/, "");
  return { tables: [{ sheet: null, csv: parseCsv(text) }], preamble: preambleRows(text) };
}

export function isPdf(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

/** Identify one uploaded file. CAS PDFs are recognised here; their password check happens later. */
export function sniffFile(params: { filename: string; content: string; encoding?: "base64" }): FileSniff {
  const buf = params.encoding === "base64" ? Buffer.from(params.content, "base64") : Buffer.from(params.content, "utf8");
  const blank = { accountRef: null, holderName: null, sheet: null };

  if (isPdf(buf)) {
    return { kind: "transactions", adapter: "cas", confidence: 0.9, reason: "Mutual fund Consolidated Account Statement (PDF)", brokerFamily: null, ...blank };
  }

  // Multi-sheet broker profit reports (Zerodha tax P&L / P&L, Vested P&L statement): sectioned
  // tables no single-table reader understands. They cross-check the ledger.
  if (params.encoding === "base64" && looksLikeXlsx(buf, params.filename)) {
    const wb = XLSX.read(buf, { type: "buffer" });
    const format = identifyBrokerReport(wb);
    if (format) {
      const id = reportIdentity(wb, format);
      const reason =
        format === "zerodha-taxpnl"
          ? "Zerodha tax P&L — used to double-check your numbers, and its dividends & interest are added"
          : "Your broker's profit & loss report, used to double-check your numbers and fill in any closing trades the statement missed";
      return { kind: "pnl_report", adapter: null, confidence: 0.9, reason, brokerFamily: id.brokerFamily, accountRef: id.accountRef, holderName: id.holderName, sheet: null };
    }
  }

  const { tables, preamble } = tablesOf(buf, params.filename, params.encoding);
  const { accountRef: refInFile, holderName } = sniffKeyValues(preamble);

  // Best importable table across all sheets: highest confidence, then most rows.
  let best: { table: Table; broker: string; confidence: number; reason: string } | null = null;
  for (const t of tables) {
    const d = detectBest(t.csv);
    if (!d) continue;
    if (!best || d.confidence > best.confidence || (d.confidence === best.confidence && t.csv.rows.length > best.table.csv.rows.length)) {
      best = { table: t, broker: d.broker, confidence: d.confidence, reason: d.reason };
    }
  }

  const nameFamily = familyFromText(params.filename) ?? familyFromContents(preamble.slice(0, 40).map((r) => r.join(" ")).join(" "));
  const familyFor = (adapter: string | null): string | null => {
    const fams = adapter ? brokerFamiliesOf(adapter) : [];
    const specific = fams.find((f) => f !== "*" && f !== "crypto");
    return specific ?? nameFamily ?? null;
  };
  const refFor = (family: string | null) => refInFile ?? (family === "zerodha" || nameFamily === "zerodha" ? refFromFilename(params.filename) : null);

  if (best) {
    const family = familyFor(best.broker);
    return {
      kind: "transactions",
      adapter: best.broker,
      confidence: best.confidence,
      reason: best.reason,
      brokerFamily: family,
      accountRef: refFor(family),
      holderName,
      sheet: best.table.sheet,
    };
  }

  const first = tables.find((t) => t.csv.rows.length > 0);
  if (first && isPriceSnapshot(first.csv)) {
    // Prices attach to securities, not accounts, so the broker only matters as a label here.
    const family = nameFamily;
    return { kind: "prices", adapter: null, confidence: 0.7, reason: "Holdings snapshot with closing prices (no cost), used to price your positions", brokerFamily: family, accountRef: refFor(family), holderName, sheet: first.sheet };
  }
  if (first && isPnlReport(first.csv)) {
    if (isCheckablePnl(first.csv)) {
      // Dhan's layout ("Scrip Name", "Avg. Buy Price") doesn't say "Dhan" anywhere but the column names.
      const family = nameFamily ?? (hasAll(first.csv.headers, "scrip name", "avg. buy price") ? "dhan" : null);
      return { kind: "pnl_report", adapter: null, confidence: 0.8, reason: "Your broker's profit & loss report, used to double-check your numbers and fill in any closing trades the statement missed", brokerFamily: family, accountRef: refInFile, holderName, sheet: first.sheet };
    }
    return { kind: "not_needed", adapter: null, confidence: 0.8, reason: "A profit & loss summary. Your ledger works this out from your trades, so it isn't imported", brokerFamily: nameFamily, accountRef: refInFile, holderName, sheet: first.sheet };
  }
  return { kind: "unrecognized", adapter: null, confidence: 0, reason: "This file's layout isn't one we know yet", brokerFamily: nameFamily, accountRef: refInFile, holderName, sheet: null };
}
