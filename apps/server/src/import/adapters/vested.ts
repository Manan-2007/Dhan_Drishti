import type { BrokerAdapter, ParsedCsv, NormalizedRow, DetectResult } from "../types.js";
import { pick, hasHeader, rowHash } from "../csv.js";

// Vested (US stocks for Indian investors) — the "Trades" sheet of the Transactions export. USD equities.
const SYMBOL = ["ticker", "symbol", "stock", "instrument"];
const SIDE = ["activity", "side", "type", "transaction type", "action", "buy/sell", "buysell", "order type"];
const QTY = ["quantity", "shares", "units", "qty", "no. of shares", "no of shares", "filled qty"];
const PRICE = ["price per share (in usd)", "price per share", "price", "trade price", "execution price", "avg price", "price (usd)", "share price", "executed price"];
const AMOUNT = ["cash amount (in usd)", "cash amount", "amount", "total", "value", "net amount", "total amount", "amount (usd)"];
const DATE = ["date", "trade date", "transaction date", "execution date", "order date", "time", "executed at"];
const FEES = ["commission charges (in usd)", "commission charges", "fees", "fee", "commission", "charges"];
const REF = ["order id", "orderid", "transaction id", "reference", "confirmation"];

function normSide(raw: string | undefined): "buy" | "sell" | null {
  const s = (raw ?? "").toLowerCase().trim();
  if (["buy", "bought", "b", "purchase", "buy to open"].includes(s)) return "buy";
  if (["sell", "sold", "s", "sell to close"].includes(s)) return "sell";
  return null;
}

/** US brokers export MM/DD/YYYY or ISO; Date.parse handles both. */
function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export const vestedAdapter: BrokerAdapter = {
  id: "vested",
  label: "Vested (US stocks)",

  detect(csv: ParsedCsv): DetectResult {
    const core = hasHeader(csv.headers, SYMBOL) && hasHeader(csv.headers, SIDE) && hasHeader(csv.headers, QTY) && hasHeader(csv.headers, PRICE);
    // US-equity hints that separate it from INR tradebooks (which carry ISIN/trade_id).
    const hint =
      hasHeader(csv.headers, ["shares", "no. of shares", "no of shares"]) ||
      hasHeader(csv.headers, ["amount (usd)", "price (usd)", "price per share (in usd)", "cash amount (in usd)"]);
    const confidence = core ? (hint ? 0.75 : 0.4) : 0;
    return { broker: "vested", confidence, reason: core ? "Recognized a US-stock order export" : "Missing symbol/side/quantity/price columns" };
  },

  normalize(csv: ParsedCsv): NormalizedRow[] {
    return csv.rows.map((raw, i): NormalizedRow => {
      const rowIndex = i;
      const symbol = pick(raw, SYMBOL);
      const side = normSide(pick(raw, SIDE));
      const qty = pick(raw, QTY);
      const price = pick(raw, PRICE);
      const tradeDate = parseDate(pick(raw, DATE));

      if (!symbol) return { ok: false, error: "Missing symbol", raw, rowIndex };
      if (!side) return { ok: false, error: `Unrecognized side '${pick(raw, SIDE) ?? ""}'`, raw, rowIndex };
      if (!qty || !Number.isFinite(Number(qty)) || Number(qty) <= 0) return { ok: false, error: `Invalid quantity '${qty ?? ""}'`, raw, rowIndex };
      if (!price || !Number.isFinite(Number(price))) return { ok: false, error: `Invalid price '${price ?? ""}'`, raw, rowIndex };
      if (!tradeDate) return { ok: false, error: `Invalid date '${pick(raw, DATE) ?? ""}'`, raw, rowIndex };

      const amount = pick(raw, AMOUNT);
      const grossAmount = amount && Number.isFinite(Number(amount)) ? String(Math.abs(Number(amount))) : String(Number(qty) * Number(price));
      const feesRaw = pick(raw, FEES);
      const fees = feesRaw && Number.isFinite(Number(feesRaw)) ? String(Math.abs(Number(feesRaw))) : "0";

      return {
        ok: true,
        rowIndex,
        rawHash: rowHash("vested", csv.rawLines[i] ?? `${symbol}|${tradeDate}|${side}|${qty}|${price}`),
        tx: {
          security: { symbol: symbol.toUpperCase(), assetClass: "equity" }, // US listing → Yahoo resolves by symbol
          type: side,
          tradeDate,
          quantity: String(Number(qty)),
          price: String(Number(price)),
          grossAmount,
          fees,
          taxes: "0",
          currency: "USD",
          segment: "equity",
          externalRef: pick(raw, REF) || undefined,
        },
      };
    });
  },
};
