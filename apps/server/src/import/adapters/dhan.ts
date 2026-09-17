import type { Segment } from "@dhan-drishti/core";
import type { BrokerAdapter, ParsedCsv, NormalizedRow, DetectResult } from "../types.js";
import { pick, hasHeader, rowHash } from "../csv.js";

// Dhan's tradebook keys securities by full Name (no ticker/ISIN in the export).
const NAME = ["name", "security", "scrip"];
const ISIN = ["isin"];
const DATE = ["date", "trade date", "trade_date"];
const TIME = ["time", "trade time"];
const EXCH = ["exchange", "exch"];
const SEGMENT = ["segment", "seg"];
const SIDE = ["buysell", "buy/sell", "buy sell", "trade_type", "type", "side"];
const QTY = ["quantity", "qty"];
const PRICE = ["tradeprice", "trade price", "price"];
const AMOUNT = ["tradevalue", "trade value", "amount", "value"];
const ORDER_ID = ["order id", "order_id", "orderid", "trade id", "trade_id"];

function toSegment(raw: string | undefined): Segment {
  const s = (raw ?? "").toUpperCase();
  if (s.includes("FUT") || s.includes("OPT") || s === "FNO" || s === "NFO") return "fno";
  if (s.includes("COMM") || s === "MCX") return "commodity";
  if (s.includes("CURR") || s === "CDS") return "other";
  return "equity";
}

function parseDateTime(dateRaw: string | undefined, timeRaw: string | undefined): string | null {
  if (!dateRaw) return null;
  const dmy = dateRaw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  const iso = dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : dateRaw;
  const combined = timeRaw ? `${iso} ${timeRaw}` : iso;
  const t = Date.parse(combined);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  const t2 = Date.parse(iso);
  return Number.isNaN(t2) ? null : new Date(t2).toISOString();
}

function normSide(raw: string | undefined): "buy" | "sell" | null {
  const s = (raw ?? "").toLowerCase();
  if (s === "buy" || s === "b") return "buy";
  if (s === "sell" || s === "s") return "sell";
  return null;
}

export const dhanAdapter: BrokerAdapter = {
  id: "dhan",
  label: "Dhan (Tradebook)",

  detect(csv: ParsedCsv): DetectResult {
    const core = hasHeader(csv.headers, NAME) && hasHeader(csv.headers, SIDE) && hasHeader(csv.headers, QTY) && hasHeader(csv.headers, PRICE);
    // Dhan-specific hints: has TradePrice/TradeValue naming or a Name (not Symbol) column.
    const hint = hasHeader(csv.headers, ["tradeprice", "trade price", "tradevalue"]) || (hasHeader(csv.headers, NAME) && !hasHeader(csv.headers, ["symbol", "tradingsymbol"]));
    const confidence = core ? (hint ? 0.85 : 0.5) : 0;
    return { broker: "dhan", confidence, reason: core ? "Recognized Dhan tradebook columns" : "Missing name/side/quantity/price columns" };
  },

  normalize(csv: ParsedCsv): NormalizedRow[] {
    return csv.rows.map((raw, i): NormalizedRow => {
      const rowIndex = i;
      const name = pick(raw, NAME);
      const side = normSide(pick(raw, SIDE));
      const qty = pick(raw, QTY);
      const price = pick(raw, PRICE);
      const tradeDate = parseDateTime(pick(raw, DATE), pick(raw, TIME));

      if (!name) return { ok: false, error: "Missing security name", raw, rowIndex };
      if (!side) return { ok: false, error: `Unrecognized side '${pick(raw, SIDE) ?? ""}'`, raw, rowIndex };
      if (!qty || !Number.isFinite(Number(qty)) || Number(qty) <= 0) return { ok: false, error: `Invalid quantity '${qty ?? ""}'`, raw, rowIndex };
      if (!price || !Number.isFinite(Number(price))) return { ok: false, error: `Invalid price '${price ?? ""}'`, raw, rowIndex };
      if (!tradeDate) return { ok: false, error: `Invalid date '${pick(raw, DATE) ?? ""}'`, raw, rowIndex };

      const amount = pick(raw, AMOUNT);
      const grossAmount = amount && Number.isFinite(Number(amount)) ? String(Number(amount)) : String(Number(qty) * Number(price));
      const externalRef = pick(raw, ORDER_ID);

      return {
        ok: true,
        rowIndex,
        rawHash: rowHash("dhan", csv.rawLines[i] ?? `${name}|${tradeDate}|${side}|${qty}|${price}`),
        tx: {
          security: { symbol: name.toUpperCase(), name, isin: pick(raw, ISIN), assetClass: "equity", exchange: pick(raw, EXCH)?.toUpperCase() },
          type: side,
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
