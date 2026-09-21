import { rowHash } from "./csv.js";
import type { NormalizedRow } from "./types.js";

/**
 * Mutual-fund Consolidated Account Statement (CAS) importer. A CAS is one password-protected PDF
 * (from CAMS or KFintech, keyed to a PAN) that lists every folio, scheme and transaction across
 * all AMCs — so a single upload replaces hunting down a file per fund house. We extract the text
 * (with the password), then read the per-scheme transaction rows into the normalized ledger:
 * purchases/SIPs/switch-ins → buy, redemptions/switch-outs → sell, dividend payouts → dividend.
 */

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/** "02-Apr-2025" → ISO date; null if not a CAS date. */
function parseCasDate(raw: string): string | null {
  const m = raw.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mm = MONTHS[m[2]!.toUpperCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1]}T00:00:00.000Z`;
}

/** Parse an Indian-formatted number; parentheses denote a negative (redemption) amount. */
function num(raw: string): number {
  let s = raw.trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/,/g, "");
  const v = Number(s);
  if (!Number.isFinite(v)) return NaN;
  return neg ? -v : v;
}

/** Reconstruct visual lines from pdf.js text items by grouping on the y-coordinate. */
function itemsToLines(items: { str: string; transform: number[] }[]): string {
  const rows = new Map<number, { x: number; str: string }[]>();
  for (const it of items) {
    if (!it.str) continue;
    const y = Math.round(it.transform[5]!);
    const line = rows.get(y) ?? [];
    line.push({ x: it.transform[4]!, str: it.str });
    rows.set(y, line);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0]) // top of page first (PDF y grows upward)
    .map(([, cells]) => cells.sort((a, b) => a.x - b.x).map((c) => c.str).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
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

const ISIN_RE = /\b(INF[A-Z0-9]{9})\b/;
// A transaction row: date  description  amount  units  nav  unit-balance (Indian numbers, () = negative).
const TXN_RE = /^(\d{2}-[A-Za-z]{3}-\d{4})\s+(.+?)\s+(\(?-?[\d,]+\.\d{2}\)?)\s+(\(?-?[\d,]+\.\d{2,4}\)?)\s+([\d,]+\.\d{2,6})\s+(\(?-?[\d,]+\.\d{2,4}\)?)\s*$/;

/** Classify a CAS transaction description + unit sign into a ledger type (null = skip: stamp duty, tax…). */
function classifyRow(desc: string, units: number): "buy" | "sell" | "dividend" | null {
  const d = desc.toUpperCase();
  if (/STAMP\s*DUTY|STT|\*{2,}|SERVICE TAX|STAMP/.test(d) && units === 0) return null;
  if (units < 0 || /REDEMPTION|REDEEM|SWITCH[\s-]*OUT|SWP|REVERSAL/.test(d)) return "sell";
  if (units > 0) return "buy"; // purchase / SIP / switch-in / dividend reinvestment
  if (/DIVIDEND|IDCW|PAYOUT/.test(d)) return "dividend"; // payout: cash, no units
  return null;
}

/** Parse extracted CAS text into normalized mutual-fund transactions. */
export function parseCasTransactions(text: string): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  const lines = text.split(/\r?\n/);
  let scheme = "";
  let isin: string | undefined;
  let folio = "";
  let rowIndex = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const folioM = line.match(/Folio\s*No[.:\s]+([0-9][0-9/\s]*)/i);
    if (folioM) { folio = folioM[1]!.replace(/\s+/g, "").trim(); continue; }

    const isinM = line.match(ISIN_RE);
    if (isinM) {
      isin = isinM[1]!;
      // The scheme name usually shares this line (before the ISIN) or is the text before it.
      const before = line.slice(0, isinM.index).replace(/ISIN[:\s]*$/i, "").trim();
      if (before.length > 4) scheme = before.replace(/\(Advisor.*$/i, "").replace(/Registrar.*$/i, "").trim();
      continue;
    }

    const m = line.match(TXN_RE);
    if (!m) {
      // A non-transaction, non-ISIN line that looks like a scheme header (has letters, no leading date).
      if (/[A-Za-z]{4,}/.test(line) && /FUND|SCHEME|PLAN|EQUITY|DEBT|LIQUID|ETF/i.test(line) && !/^\d/.test(line)) {
        scheme = line.replace(/\(Advisor.*$/i, "").replace(/Registrar.*$/i, "").replace(/ISIN.*$/i, "").trim();
      }
      continue;
    }

    const tradeDate = parseCasDate(m[1]!);
    const desc = m[2]!.trim();
    const amount = num(m[3]!);
    const units = num(m[4]!);
    const nav = num(m[5]!);
    if (!tradeDate || !Number.isFinite(amount) || !Number.isFinite(units) || !Number.isFinite(nav)) continue;

    const type = classifyRow(desc, units);
    if (!type) continue;
    if (!scheme && !isin) continue; // can't attribute this row to a fund

    const symbol = (isin ?? scheme.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40)) || "MF";
    const qty = type === "dividend" ? "0" : String(Math.abs(units));
    const price = type === "dividend" ? "0" : String(nav);
    out.push({
      ok: true,
      rowIndex: rowIndex++,
      rawHash: rowHash("cas", `${isin ?? scheme}|${folio}|${m[1]}|${desc}|${units}|${amount}`),
      tx: {
        security: { symbol, isin, name: scheme || symbol, assetClass: "mf" },
        type,
        tradeDate,
        quantity: qty,
        price,
        grossAmount: String(Math.abs(amount)),
        fees: "0",
        taxes: "0",
        currency: "INR",
        segment: "mf",
      },
    });
  }
  return out;
}
