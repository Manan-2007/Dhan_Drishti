import type { Segment } from "@dhan-drishti/core";
import type { BrokerAdapter, ParsedCsv, NormalizedRow, DetectResult } from "../types.js";
import { pick, hasHeader, rowHash } from "../csv.js";

const SYMBOL = ["symbol", "tradingsymbol"];
const ISIN = ["isin"];
const DATE = ["trade_date", "tradedate", "trade date", "date"];
const EXCH = ["exchange", "exch"];
const SEGMENT = ["segment", "seg"];
const TRADE_TYPE = ["trade_type", "tradetype", "trade type", "buysell", "type"];
const QTY = ["quantity", "qty"];
const PRICE = ["price", "trade_price", "tradeprice"];
const AMOUNT = ["amount", "trade_value", "tradevalue", "value"];
const TRADE_ID = ["trade_id", "tradeid", "trade id"];
const ORDER_ID = ["order_id", "orderid", "order id"];

function toSegment(raw: string | undefined): Segment {
  const s = (raw ?? "").toUpperCase();
  if (s === "EQ" || s === "BE" || s === "") return "equity";
  if (s.includes("FO") || s === "NFO" || s === "FUT" || s === "OPT") return "fno";
  if (s === "MCX" || s === "COM") return "commodity";
  if (s === "CDS" || s === "BCD") return "other";
  return "equity";
}

function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  // Handles YYYY-MM-DD, ISO datetimes, and DD-MM-YYYY / DD/MM/YYYY.
  const dmy = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  const iso = dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : raw;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function normType(raw: string | undefined): "buy" | "sell" | null {
  const s = (raw ?? "").toLowerCase();
  if (s === "buy" || s === "b") return "buy";
  if (s === "sell" || s === "s") return "sell";
  return null;
}

export const zerodhaAdapter: BrokerAdapter = {
  id: "zerodha",
  label: "Zerodha (Tradebook)",

  detect(csv: ParsedCsv): DetectResult {
    const hasCore =
      hasHeader(csv.headers, SYMBOL) &&
      hasHeader(csv.headers, TRADE_TYPE) &&
      hasHeader(csv.headers, QTY) &&
      hasHeader(csv.headers, PRICE);
    const hasZerodhaMarkers = hasHeader(csv.headers, TRADE_ID) || hasHeader(csv.headers, ISIN);
    const confidence = hasCore ? (hasZerodhaMarkers ? 0.9 : 0.5) : 0;
    return {
      broker: "zerodha",
      confidence,
      reason: hasCore
        ? `Recognized tradebook columns${hasZerodhaMarkers ? " with ISIN/trade_id" : ""}`
        : "Missing symbol/trade_type/quantity/price columns",
    };
  },

  normalize(csv: ParsedCsv): NormalizedRow[] {
    return csv.rows.map((raw, i): NormalizedRow => {
      const rowIndex = i;
      const symbol = pick(raw, SYMBOL);
      const type = normType(pick(raw, TRADE_TYPE));
      const qty = pick(raw, QTY);
      const price = pick(raw, PRICE);
      const dateRaw = pick(raw, DATE);
      const tradeDate = parseDate(dateRaw);

      if (!symbol) return { ok: false, error: "Missing symbol", raw, rowIndex };
      if (!type) return { ok: false, error: `Unrecognized trade type '${pick(raw, TRADE_TYPE) ?? ""}'`, raw, rowIndex };
      if (!qty || !Number.isFinite(Number(qty)) || Number(qty) <= 0)
        return { ok: false, error: `Invalid quantity '${qty ?? ""}'`, raw, rowIndex };
      if (!price || !Number.isFinite(Number(price)))
        return { ok: false, error: `Invalid price '${price ?? ""}'`, raw, rowIndex };
      if (!tradeDate) return { ok: false, error: `Invalid trade date '${dateRaw ?? ""}'`, raw, rowIndex };

      const amount = pick(raw, AMOUNT);
      const grossAmount = amount && Number.isFinite(Number(amount)) ? String(Number(amount)) : String(Number(qty) * Number(price));
      const externalRef = pick(raw, TRADE_ID) ?? pick(raw, ORDER_ID);

      return {
        ok: true,
        rowIndex,
        rawHash: rowHash("zerodha", csv.rawLines[i] ?? `${symbol}|${tradeDate}|${type}|${qty}|${price}`),
        tx: {
          security: {
            symbol: symbol.toUpperCase(),
            isin: pick(raw, ISIN),
            assetClass: "equity",
            exchange: pick(raw, EXCH)?.toUpperCase(),
          },
          type,
          tradeDate,
          quantity: String(Number(qty)),
          price: String(Number(price)),
          grossAmount,
          fees: "0",
          taxes: "0",
          currency: "INR",
          segment: toSegment(pick(raw, SEGMENT)),
          externalRef: externalRef || undefined,
        },
      };
    });
  },
};
