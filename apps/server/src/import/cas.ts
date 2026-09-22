import { rowHash } from "./csv.js";
import type { NormalizedRow } from "./types.js";

/**
 * Mutual-fund Consolidated Account Statement (CAS) importer. A CAS is one password-protected PDF
 * (from CAMS or KFintech, keyed to a PAN) that lists every folio, scheme and transaction across
 * all AMCs — so a single upload replaces hunting down a file per fund house. We extract the text
 * (with the password), then read the per-scheme transaction rows into the normalized ledger.
 *
 * Real statements vary a lot between RTAs and years, so the row reader is deliberately tolerant:
 * it keys off the LEADING date and the TRAILING run of numeric columns (amount, units, NAV,
 * balance) — units/NAV/balance are absent on dividend & fee rows — and classifies by the sign of
 * the units (the authoritative signal), matching the approach of the reference `casparser` project.
 */

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/** "05-Apr-2025", "5-Apr-2025" or "05 Apr 2025" → ISO date; null if not a CAS date. */
function parseCasDate(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/);
  if (!m) return null;
  const mm = MONTHS[m[2]!.toUpperCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1]!.padStart(2, "0")}T00:00:00.000Z`;
}

/** Parse an Indian-formatted number; parentheses (or a leading -) denote a negative. NaN if not one. */
function num(raw: string): number {
  let s = raw.trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  s = s.replace(/,/g, "");
  const v = Number(s);
  if (!Number.isFinite(v)) return NaN;
  return neg ? -v : v;
}

// A single numeric column token: Indian grouping, a required decimal point, optional () or - sign.
const NUM_TOKEN = /^\(?-?[\d,]+\.\d{1,6}\)?$/;
// An Indian MF ISIN: INF + 8 alphanumerics + a check digit.
const ISIN_RE = /\b(INF[0-9A-Z]{8}\d)\b/;
// A row that begins with a transaction date (day, Mon, year), separated by "-" or spaces.
const LEADING_DATE_RE = /^(\d{1,2}[-\s][A-Za-z]{3}[-\s]\d{4})\b\s*(.*)$/;

/** Group pdf.js text items into visual lines, clustering by y with a small tolerance (sub-pixel
 *  drift and superscripts would otherwise split one visual line into several). */
function itemsToLines(items: { str: string; transform: number[] }[]): string {
  const cells = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({ x: it.transform[4]!, y: it.transform[5]!, str: it.str }));
  if (cells.length === 0) return "";
  cells.sort((a, b) => b.y - a.y); // top of page first (PDF y grows upward); x is ordered per line below
  const lines: string[] = [];
  let current: { x: number; str: string }[] = [];
  let lineY = cells[0]!.y;
  for (const c of cells) {
    if (Math.abs(c.y - lineY) > 2.5) {
      lines.push(current.sort((a, b) => a.x - b.x).map((p) => p.str).join(" ").replace(/\s+/g, " ").trim());
      current = [];
      lineY = c.y;
    }
    current.push({ x: c.x, str: c.str });
  }
  if (current.length) lines.push(current.sort((a, b) => a.x - b.x).map((p) => p.str).join(" ").replace(/\s+/g, " ").trim());
  return lines.filter(Boolean).join("\n");
}

/** Extract the full text of a (password-protected) CAS PDF. Throws a typed error on a bad password. */
export async function extractCasText(data: Buffer, password?: string): Promise<string> {
  // Loaded lazily so the pdf.js dependency isn't paid for on non-CAS imports.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const opts = { data: new Uint8Array(data), password: password ?? "", isEvalSupported: false, useSystemFonts: true };
  let doc;
  try {
    doc = await pdfjs.getDocument(opts as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "PasswordException") {
      const e = new Error("This statement is password-protected. Enter the CAS password (usually your PAN).");
      (e as { code?: string }).code = "cas_password";
      throw e;
    }
    throw err;
  }
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(itemsToLines(content.items as { str: string; transform: number[] }[]));
  }
  await (doc as { destroy?: () => Promise<void> }).destroy?.();
  return parts.join("\n");
}

/** Tidy a scheme name: drop ISIN/advisor/registrar markers and any leading AMC scheme-code token. */
function cleanSchemeName(raw: string): string {
  let name = raw
    .replace(/\bISIN\b.*$/i, "")
    .replace(/\(\s*Advisor\b.*$/i, "")
    .replace(/\bRegistrar\b.*$/i, "")
    .replace(/\bRTA\b.*$/i, "")
    .replace(/\(\s*ARN[-\s]?\d+.*$/i, "")
    .trim();
  // e.g. "B510GZ-DSP Liquidity Fund…" or "128TSDGG-…" — a leading code helps neither display nor
  // the AMFI name match, so strip it when a real (spaced) name follows.
  const stripped = name.replace(/^[0-9A-Z]{4,12}-(?=[A-Za-z])/, "").trim();
  if (stripped.includes(" ") && stripped.length >= 6) name = stripped;
  return name.replace(/[-(\s]+$/, "").trim();
}

/** Does a non-date, non-ISIN line look like a scheme header (so we can carry its name forward)? */
function looksLikeSchemeName(line: string): boolean {
  return (
    !/^\d/.test(line) &&
    /[A-Za-z]{4,}/.test(line) &&
    /\b(FUND|SCHEME|PLAN|EQUITY|DEBT|LIQUID|ETF|IDCW|GROWTH|INDEX|GILT|HYBRID|BALANCED|SAVINGS|INCOME|BLUECHIP|FLEXI|MIDCAP|SMALLCAP|LARGECAP)\b/i.test(line)
  );
}

/** Split a post-date row into its description and the trailing run of numeric columns. */
function splitRow(rest: string): { desc: string; tail: number[] } {
  const tokens = rest.split(/\s+/).filter(Boolean);
  const tail: string[] = [];
  let i = tokens.length - 1;
  while (i >= 0 && NUM_TOKEN.test(tokens[i]!)) {
    tail.unshift(tokens[i]!);
    i -= 1;
  }
  return { desc: tokens.slice(0, i + 1).join(" ").trim(), tail: tail.map(num) };
}

const OUTFLOW_RE = /REDEMPTION|REDEEM|SWITCH[\s-]*OUT|SWITCHED\s*OUT|SWP|STP\s*OUT|TRANSFER\s*OUT|REVERSAL|REJECT|DISHONOU?R/;
const FEE_RE = /STAMP|STT|\bTDS\b|SECURITIES\s*TRANSACTION|SERVICE\s*TAX|\*{2,}/;
const DIVIDEND_RE = /DIVIDEND|IDCW|\bDIV\.?\b|PAYOUT/;

/** Classify a CAS row into a ledger type from its description + the sign of its units.
 *  Sign of units is authoritative; keywords only disambiguate the zero-unit and quirk cases. */
function classifyRow(desc: string, units: number): "buy" | "sell" | "dividend" | null {
  const d = desc.toUpperCase();
  if (units > 0) return OUTFLOW_RE.test(d) ? "sell" : "buy"; // purchase/SIP/switch-in/STP-in/reinvest/segregation
  if (units < 0) return "sell"; // redemption/switch-out/STP-out/reversal
  // Zero (or unknown) units: a fee row is skipped; a cash dividend payout is income.
  if (FEE_RE.test(d)) return null;
  if (DIVIDEND_RE.test(d)) return "dividend";
  return null;
}

/** Parse extracted CAS text into normalized mutual-fund transactions. */
export function parseCasTransactions(text: string): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  const lines = text.split(/\r?\n/);
  let scheme = "";
  let isin: string | undefined;
  let folio = "";
  let prevText = "";
  let rowIndex = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Folio line: "Folio No : 12345 / 21" (stop before PAN/KYC that may follow).
    const folioM = line.match(/Folio\s*No[.:\s]+([0-9][0-9/\s]*)/i);
    if (folioM) { folio = folioM[1]!.replace(/\s+/g, "").trim(); prevText = ""; continue; }

    // Transaction row: begins with a date. If it carries no numeric columns (e.g. the statement
    // period "01-Apr-2024 To 31-Mar-2025", or a "NAV on <date>" note), it's just skipped.
    const dateM = line.match(LEADING_DATE_RE);
    if (dateM) {
      const tradeDate = parseCasDate(dateM[1]!.trim());
      const { desc, tail } = splitRow(dateM[2] ?? "");
      if (!tradeDate || tail.length === 0) continue;

      // The last up-to-4 numbers are [amount, units, nav, balance]; dividend/fee rows have fewer.
      const L = tail.length;
      const amount = L >= 4 ? tail[L - 4]! : tail[0]!;
      let units = L >= 4 ? tail[L - 3]! : L === 3 ? tail[1]! : 0;
      let nav = L >= 4 ? tail[L - 2]! : L === 3 ? tail[2]! : 0;
      if (!Number.isFinite(amount)) continue;

      const type = classifyRow(desc, units);
      if (!type) continue;
      if (!scheme && !isin) continue; // can't attribute this row to a fund

      // Back-derive a missing NAV (some layouts leave the column blank) from amount ÷ units.
      if ((type === "buy" || type === "sell") && (!Number.isFinite(nav) || nav <= 0) && Math.abs(units) > 0) {
        nav = Math.abs(amount / units);
      }
      if (type === "dividend") { units = 0; nav = 0; }

      const symbol = (isin ?? scheme.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40)) || "MF";
      out.push({
        ok: true,
        rowIndex: rowIndex++,
        rawHash: rowHash("cas", `${isin ?? scheme}|${folio}|${dateM[1]}|${desc}|${units}|${amount}`),
        tx: {
          security: { symbol, isin, name: scheme || symbol, assetClass: "mf" },
          type,
          tradeDate,
          quantity: type === "dividend" ? "0" : String(Math.abs(units)),
          price: type === "dividend" ? "0" : String(nav),
          grossAmount: String(Math.abs(amount)),
          fees: "0",
          taxes: "0",
          currency: "INR",
          segment: "mf",
        },
      });
      continue;
    }

    // Scheme header: a line carrying an ISIN. The name is the text before it, or (when the name
    // wrapped to its own line above) the previous line.
    const isinM = line.match(ISIN_RE);
    if (isinM) {
      isin = isinM[1]!;
      const rawBefore = line.slice(0, isinM.index).replace(/\(?\s*ISIN[:\s]*$/i, "").trim();
      // The name often wraps: a continuation fragment here ("- Direct Plan - Growth") belongs to
      // the fund named on the line above.
      const isContinuation = rawBefore.length < 5 || /^[-–]|^(Plan|Direct|Regular|Growth|Option|Dividend|IDCW|Reinvest|Payout)\b/i.test(rawBefore);
      const combined = prevText && isContinuation && looksLikeSchemeName(prevText) ? `${prevText} ${rawBefore}` : rawBefore;
      const name = cleanSchemeName(combined);
      scheme = name.length >= 3 ? name : cleanSchemeName(prevText) || scheme;
      prevText = "";
      continue;
    }

    // A scheme name on its own line (no ISIN yet) — remember it; also carry it as the current
    // scheme so a fund whose ISIN never resolves is still attributed by name.
    if (looksLikeSchemeName(line)) scheme = cleanSchemeName(line) || scheme;
    prevText = line;
  }
  return out;
}
