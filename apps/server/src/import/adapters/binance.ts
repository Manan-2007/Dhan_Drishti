import type { BrokerAdapter, ParsedCsv, NormalizedRow, DetectResult } from "../types.js";
import { pick, hasHeader, rowHash } from "../csv.js";

// Binance — spot "Trade History" export. Each row is a pair trade (e.g. BTCUSDT); we key the
// security by its BASE asset (BTC) as crypto, priced in the QUOTE currency (USDT→USD).
const PAIR = ["pair", "market", "symbol"];
const SIDE = ["side", "type", "buy/sell"];
const PRICE = ["price", "executed price", "avg price"];
const AMOUNT = ["amount", "executed", "quantity", "filled", "qty", "base amount"];
const TOTAL = ["total", "quote amount", "quote qty", "value"];
const DATE = ["date(utc)", "date utc", "utc_time", "utc time", "time", "date", "timestamp"];
const FEE = ["fee"];

// Longest-match first so e.g. USDT wins over USD.
const QUOTES = ["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USD", "BTC", "ETH", "BNB", "EUR", "GBP", "INR", "TRY", "AUD"];
const STABLE_USD = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USD"]);

function splitPair(market: string): { base: string; quote: string } {
  const m = market.toUpperCase().replace(/[-_/\s]/g, "");
  for (const q of QUOTES) if (m.length > q.length && m.endsWith(q)) return { base: m.slice(0, -q.length), quote: q };
  return { base: m, quote: "USD" };
}

function normSide(raw: string | undefined): "buy" | "sell" | null {
  const s = (raw ?? "").toLowerCase().trim();
  if (s === "buy" || s === "b") return "buy";
  if (s === "sell" || s === "s") return "sell";
  return null;
}

/** Binance timestamps are UTC; if the value has no timezone, treat it as UTC. */
function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) v = v.replace(" ", "T") + "Z";
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export const binanceAdapter: BrokerAdapter = {
  id: "binance",
  label: "Binance (crypto)",

  detect(csv: ParsedCsv): DetectResult {
    const core = hasHeader(csv.headers, PAIR) && hasHeader(csv.headers, PRICE) && hasHeader(csv.headers, AMOUNT) && hasHeader(csv.headers, SIDE);
    const hint = hasHeader(csv.headers, ["date(utc)", "fee coin", "feecoin"]) || hasHeader(csv.headers, ["pair", "market"]);
    const confidence = core ? (hint ? 0.8 : 0.4) : 0;
    return { broker: "binance", confidence, reason: core ? "Recognized a Binance trade history export" : "Missing pair/side/price/amount columns" };
  },

  normalize(csv: ParsedCsv): NormalizedRow[] {
    return csv.rows.map((raw, i): NormalizedRow => {
      const rowIndex = i;
      const pair = pick(raw, PAIR);
      const side = normSide(pick(raw, SIDE));
      const price = pick(raw, PRICE);
      const amount = pick(raw, AMOUNT);
      const tradeDate = parseDate(pick(raw, DATE));

      if (!pair) return { ok: false, error: "Missing pair/market", raw, rowIndex };
      if (!side) return { ok: false, error: `Unrecognized side '${pick(raw, SIDE) ?? ""}'`, raw, rowIndex };
      if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return { ok: false, error: `Invalid amount '${amount ?? ""}'`, raw, rowIndex };
      if (!price || !Number.isFinite(Number(price))) return { ok: false, error: `Invalid price '${price ?? ""}'`, raw, rowIndex };
      if (!tradeDate) return { ok: false, error: `Invalid date '${pick(raw, DATE) ?? ""}'`, raw, rowIndex };

      const { base, quote } = splitPair(pair);
      const currency = STABLE_USD.has(quote) ? "USD" : quote;
      const total = pick(raw, TOTAL);
      const grossAmount = total && Number.isFinite(Number(total)) ? String(Math.abs(Number(total))) : String(Number(amount) * Number(price));

      return {
        ok: true,
        rowIndex,
        rawHash: rowHash("binance", csv.rawLines[i] ?? `${pair}|${tradeDate}|${side}|${amount}|${price}`),
        tx: {
          security: { symbol: base, name: base, assetClass: "crypto" },
          type: side,
          tradeDate,
          quantity: String(Number(amount)),
          price: String(Number(price)),
          grossAmount,
          fees: "0", // Binance fees are charged in a fee coin; not converted here
          taxes: "0",
          currency,
          segment: "other",
          externalRef: undefined,
        },
      };
    });
  },
};
