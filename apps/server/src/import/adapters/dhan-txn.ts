import type { Segment } from "@dhan-drishti/core";
import type { BrokerAdapter, ParsedCsv, NormalizedRow, DetectResult, NormalizedTx } from "../types.js";
import { pick, hasHeader, rowHash } from "../csv.js";

/**
 * Dhan "Transaction Report" — the real all-transactions export. One row per scrip per day with
 * separate Buy Qty/Value and Sell Qty/Value columns and itemized charges. We emit a `buy` and/or
 * `sell` per row (a same-day round trip yields both), price = value/qty, fees = summed charges.
 */
const DATE = ["date"];
const NAME = ["scrip name", "name", "scrip"];
const EXCH = ["exchange", "exch"];
const BUY_QTY = ["buy qty.", "buy qty", "buy quantity"];
const BUY_VAL = ["buy value", "buy val"];
const SELL_QTY = ["sell qty.", "sell qty", "sell quantity"];
const SELL_VAL = ["sell value", "sell val"];
const CHARGE_COLS = ["brokerage", "gst", "stt", "sebi fees", "stamp duty", "txn. charges", "txn charges", "oth. charges", "other charges"];

function num(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw.replace(/[,"%\s₹]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = Date.parse(raw); // "01 Apr 2025 00:00:00"
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function symbolFromName(name: string): string {
  const m = name.match(/\(([A-Z0-9&.-]{2,})\)\s*$/i);
  return (m ? m[1]! : name).toUpperCase().trim();
}

function segmentOf(name: string): Segment {
  const s = name.toUpperCase();
  if (/\b(OPT|FUT|CE|PE)\b/.test(s) || /\d{5}\s?(CE|PE)$/.test(s)) return "fno";
  return "equity";
}

export const dhanTxnAdapter: BrokerAdapter = {
  id: "dhan-txn",
  label: "Dhan (Transaction Report)",

  detect(csv: ParsedCsv): DetectResult {
    const core = hasHeader(csv.headers, NAME) && hasHeader(csv.headers, BUY_QTY) && hasHeader(csv.headers, SELL_QTY);
    return { broker: "dhan-txn", confidence: core ? 0.9 : 0, reason: core ? "Recognized a Dhan transaction report" : "Missing scrip/buy-qty/sell-qty columns" };
  },

  normalize(csv: ParsedCsv): NormalizedRow[] {
    const out: NormalizedRow[] = [];
    csv.rows.forEach((raw, i) => {
      const name = pick(raw, NAME);
      const tradeDate = parseDate(pick(raw, DATE));
      if (!name) return; // e.g. a trailing total row
      if (!tradeDate) {
        out.push({ ok: false, error: `Invalid date '${pick(raw, DATE) ?? ""}'`, raw, rowIndex: i });
        return;
      }
      const buyQty = num(pick(raw, BUY_QTY));
      const sellQty = num(pick(raw, SELL_QTY));
      const buyVal = num(pick(raw, BUY_VAL));
      const sellVal = num(pick(raw, SELL_VAL));
      const charges = CHARGE_COLS.reduce((sum, c) => sum + num(pick(raw, [c])), 0);
      const symbol = symbolFromName(name);
      const segment = segmentOf(name);
      const exchange = pick(raw, EXCH)?.toUpperCase();
      const base = { symbol, name, assetClass: "equity" as const, exchange };

      const legs: { type: "buy" | "sell"; qty: number; value: number; fees: number }[] = [];
      if (buyQty > 0) legs.push({ type: "buy", qty: buyQty, value: buyVal, fees: charges }); // charges on the buy leg
      if (sellQty > 0) legs.push({ type: "sell", qty: sellQty, value: sellVal, fees: buyQty > 0 ? 0 : charges });

      if (legs.length === 0) return; // no tradable quantity on this row
      legs.forEach((leg, li) => {
        const price = leg.qty > 0 ? leg.value / leg.qty : 0;
        const tx: NormalizedTx = {
          security: base,
          type: leg.type,
          tradeDate,
          quantity: String(leg.qty),
          price: String(price),
          grossAmount: String(leg.value),
          fees: String(leg.fees),
          taxes: "0",
          currency: "INR",
          segment,
        };
        out.push({ ok: true, rowIndex: i, rawHash: rowHash("dhan-txn", `${csv.rawLines[i] ?? name}|${leg.type}|${li}`), tx });
      });
    });
    return out;
  },
};
