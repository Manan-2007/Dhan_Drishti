import type { BrokerAdapter, ParsedCsv, NormalizedRow, DetectResult } from "../types.js";
import { pick, hasHeader, rowHash } from "../csv.js";

/**
 * Dividend statement — cash dividends received (e.g. Dhan "Dividend payout"). Maps each row to
 * a `dividend` income transaction against the paying security.
 */
const DATE = ["date", "payment date", "credit date", "pay date"];
const SCRIP = ["scrip name", "name", "symbol", "security", "instrument", "company"];
const AMOUNT = ["dividend paid", "dividend amount", "net dividend", "amount", "total dividend", "dividend"];
const ISIN = ["isin", "isin code"];

function normNum(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.replace(/[,"%\s₹]/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Extract a ticker from a name like "Nippon Gold ETF (GOLDBEES)" → GOLDBEES; else the name. */
function symbolFromName(name: string): string {
  const m = name.match(/\(([A-Z0-9&.-]{2,})\)\s*$/i);
  return (m ? m[1]! : name).toUpperCase().trim();
}

export const dividendsAdapter: BrokerAdapter = {
  id: "dividends",
  label: "Dividend statement",

  detect(csv: ParsedCsv): DetectResult {
    const core = hasHeader(csv.headers, SCRIP) && hasHeader(csv.headers, AMOUNT) && hasHeader(csv.headers, DATE);
    const hint = hasHeader(csv.headers, ["dividend paid", "dividend per share", "dividend amount"]);
    return { broker: "dividends", confidence: core ? (hint ? 0.75 : 0.4) : 0, reason: core ? "Recognized a dividend statement" : "Missing date/name/amount columns" };
  },

  normalize(csv: ParsedCsv): NormalizedRow[] {
    return csv.rows.map((raw, i): NormalizedRow => {
      const name = pick(raw, SCRIP);
      const amount = normNum(pick(raw, AMOUNT));
      const dateRaw = pick(raw, DATE);
      const t = dateRaw ? Date.parse(dateRaw) : NaN;

      if (!name) return { ok: false, error: "Missing scrip name", raw, rowIndex: i };
      if (amount == null || amount <= 0) return { ok: false, error: `Invalid dividend amount '${pick(raw, AMOUNT) ?? ""}'`, raw, rowIndex: i };
      if (Number.isNaN(t)) return { ok: false, error: `Invalid date '${dateRaw ?? ""}'`, raw, rowIndex: i };

      return {
        ok: true,
        rowIndex: i,
        rawHash: rowHash("dividends", csv.rawLines[i] ?? `${name}|${new Date(t).toISOString()}|${amount}`),
        tx: {
          security: { symbol: symbolFromName(name), name, isin: pick(raw, ISIN), assetClass: "equity" },
          type: "dividend",
          tradeDate: new Date(t).toISOString(),
          quantity: "0",
          price: "0",
          grossAmount: String(amount),
          fees: "0",
          taxes: "0",
          currency: "INR",
          segment: "equity",
        },
      };
    });
  },
};
