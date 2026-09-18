import type { BrokerAdapter, ParsedCsv, NormalizedRow, DetectResult } from "../types.js";
import { pick, hasHeader, rowHash } from "../csv.js";

/**
 * Funds / cash statement — deposits and withdrawals (e.g. Dhan "Fund Summary", or any
 * add/withdraw ledger). Maps each row to a `deposit` or `withdrawal` so net worth reflects the
 * money you actually put in. No security involved.
 */
const DATE = ["date & time", "date and time", "date/time", "datetime", "date", "value date", "time (in utc)"];
const TYPE = ["transaction type", "type", "activity", "particulars", "description", "narration", "remarks"];
const AMOUNT = ["amount", "net amount", "cash amount (in usd)", "cash amount", "value", "credit", "debit"];
const STATUS = ["status"];

function normNum(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.replace(/[,"%\s₹$]/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function direction(type: string | undefined): "deposit" | "withdrawal" | null {
  const t = (type ?? "").toLowerCase();
  if (/add|credit|deposit|received|fund.*in|paid in|transfer in/.test(t)) return "deposit";
  if (/withdraw|payout|debit|removed|paid out|fund.*out|transfer out/.test(t)) return "withdrawal";
  return null;
}

/** Vested's cash statements are in USD ("Cash Amount (in USD)"); Indian brokers are INR. */
function currencyOf(headers: string[]): string {
  return headers.some((h) => /\busd\b|\$/i.test(h)) ? "USD" : "INR";
}

export const fundsAdapter: BrokerAdapter = {
  id: "funds",
  label: "Funds / cash statement (deposits & withdrawals)",

  detect(csv: ParsedCsv): DetectResult {
    const core = hasHeader(csv.headers, TYPE) && hasHeader(csv.headers, AMOUNT) && hasHeader(csv.headers, DATE);
    return { broker: "funds", confidence: core ? 0.6 : 0, reason: core ? "Recognized a funds/cash statement" : "Missing date/type/amount columns" };
  },

  normalize(csv: ParsedCsv): NormalizedRow[] {
    const out: NormalizedRow[] = [];
    const currency = currencyOf(csv.headers);
    csv.rows.forEach((raw, i) => {
      const status = pick(raw, STATUS);
      if (status && !/success|complete|done|processed/i.test(status)) return; // skip failed/pending
      const dir = direction(pick(raw, TYPE));
      if (!dir) return; // not a deposit/withdrawal → ignore (e.g. header echoes, notes)
      const amount = normNum(pick(raw, AMOUNT));
      if (amount == null || amount === 0) return;
      const dateRaw = pick(raw, DATE);
      const t = dateRaw ? Date.parse(dateRaw) : NaN;
      if (Number.isNaN(t)) {
        out.push({ ok: false, error: `Invalid date '${dateRaw ?? ""}'`, raw, rowIndex: i });
        return;
      }
      const tradeDate = new Date(t).toISOString();
      out.push({
        ok: true,
        rowIndex: i,
        rawHash: rowHash("funds", csv.rawLines[i] ?? `${dir}|${tradeDate}|${amount}`),
        tx: { security: null, type: dir, tradeDate, quantity: "0", price: "0", grossAmount: String(Math.abs(amount)), fees: "0", taxes: "0", currency, segment: "other" },
      });
    });
    return out;
  },
};
