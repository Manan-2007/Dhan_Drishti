import type { AssetClass, Segment } from "@dhan-drishti/core";
import type { BrokerAdapter, ParsedCsv, NormalizedRow, DetectResult } from "../types.js";
import { pick, hasHeader, rowHash } from "../csv.js";

// Interactive Brokers — Flex/Activity "Trades" export. Quantity may be signed (− = sell),
// commission is usually a negative charge, and currency/asset-class come from their own columns.
const SYMBOL = ["symbol", "ticker"];
const ISIN = ["isin"];
const DATE = ["tradedate", "trade date", "date/time", "datetime", "date", "settledate"];
const QTY = ["quantity", "qty", "shares"];
const PRICE = ["tradeprice", "t. price", "trade price", "price"];
const SIDE = ["buy/sell", "buysell", "side"];
const COMM = ["ibcommission", "commission", "comm/fee", "comm", "fees", "fee"];
const CURRENCY = ["currencyprimary", "currency", "ccy"];
const ASSET = ["assetclass", "asset category", "assetcategory", "asset class"];

function normSide(raw: string | undefined): "buy" | "sell" | null {
  const s = (raw ?? "").toLowerCase().trim();
  if (s === "buy" || s === "bot" || s === "b") return "buy";
  if (s === "sell" || s === "sld" || s === "s") return "sell";
  return null;
}

function toAssetClass(raw: string | undefined): { assetClass: AssetClass; segment: Segment } {
  const s = (raw ?? "").toUpperCase();
  if (s === "STK") return { assetClass: "equity", segment: "equity" };
  if (s === "ETF" || s === "FUND") return { assetClass: "etf", segment: "equity" };
  if (s.includes("CRYPTO")) return { assetClass: "crypto", segment: "other" };
  if (s === "BOND") return { assetClass: "bond", segment: "other" };
  if (s === "OPT" || s === "FUT" || s === "FOP") return { assetClass: "other", segment: "fno" };
  return { assetClass: "equity", segment: "equity" };
}

function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  // IBKR often uses "YYYYMMDD" or "YYYYMMDD;HHMMSS" in Flex, or ISO in Activity.
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  const iso = compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : raw.replace(";", " ");
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export const ibkrAdapter: BrokerAdapter = {
  id: "ibkr",
  label: "Interactive Brokers",

  detect(csv: ParsedCsv): DetectResult {
    const core = hasHeader(csv.headers, SYMBOL) && hasHeader(csv.headers, PRICE) && hasHeader(csv.headers, QTY);
    const hint = hasHeader(csv.headers, ["ibcommission", "currencyprimary"]) || hasHeader(csv.headers, ASSET) || hasHeader(csv.headers, ["t. price"]);
    const confidence = core ? (hint ? 0.8 : 0.35) : 0;
    return { broker: "ibkr", confidence, reason: core ? "Recognized an IBKR trades export" : "Missing symbol/quantity/price columns" };
  },

  normalize(csv: ParsedCsv): NormalizedRow[] {
    return csv.rows.map((raw, i): NormalizedRow => {
      const rowIndex = i;
      const symbol = pick(raw, SYMBOL);
      const qtyRaw = pick(raw, QTY);
      const price = pick(raw, PRICE);
      const tradeDate = parseDate(pick(raw, DATE));
      let side = normSide(pick(raw, SIDE));
      const qtyNum = Number(qtyRaw);
      // No explicit side → infer from the sign of the (signed) quantity.
      if (!side && Number.isFinite(qtyNum)) side = qtyNum < 0 ? "sell" : "buy";

      if (!symbol) return { ok: false, error: "Missing symbol", raw, rowIndex };
      if (!qtyRaw || !Number.isFinite(qtyNum) || qtyNum === 0) return { ok: false, error: `Invalid quantity '${qtyRaw ?? ""}'`, raw, rowIndex };
      if (!side) return { ok: false, error: "Could not determine buy/sell", raw, rowIndex };
      if (!price || !Number.isFinite(Number(price))) return { ok: false, error: `Invalid price '${price ?? ""}'`, raw, rowIndex };
      if (!tradeDate) return { ok: false, error: `Invalid date '${pick(raw, DATE) ?? ""}'`, raw, rowIndex };

      const commRaw = pick(raw, COMM);
      const fees = commRaw && Number.isFinite(Number(commRaw)) ? String(Math.abs(Number(commRaw))) : "0";
      const qty = Math.abs(qtyNum);
      const { assetClass, segment } = toAssetClass(pick(raw, ASSET));
      const currency = (pick(raw, CURRENCY) ?? "USD").toUpperCase();

      return {
        ok: true,
        rowIndex,
        rawHash: rowHash("ibkr", csv.rawLines[i] ?? `${symbol}|${tradeDate}|${side}|${qty}|${price}`),
        tx: {
          security: { symbol: symbol.toUpperCase(), isin: pick(raw, ISIN), assetClass },
          type: side,
          tradeDate,
          quantity: String(qty),
          price: String(Math.abs(Number(price))),
          grossAmount: String(qty * Math.abs(Number(price))),
          fees,
          taxes: "0",
          currency,
          segment,
          externalRef: undefined,
        },
      };
    });
  },
};
