import type { BrokerAdapter, ParsedCsv, NormalizedRow, DetectResult } from "../types.js";
import { pick, hasHeader, rowHash } from "../csv.js";

/**
 * Current-holdings snapshot — the "Holdings" / "Portfolio" export many brokers offer (one row
 * per open position: instrument, quantity, average cost, and usually a last price). We turn each
 * position into a single `buy` at its average cost, and seed the last price as a quote so the
 * dashboard shows current value immediately. Snapshots have no trade dates, so the buy is dated
 * to the import; realised P&L and time-based returns aren't meaningful from a snapshot alone.
 */
const NAME = ["instrument", "name", "symbol", "tradingsymbol", "scrip", "stock", "company"];
const QTY = ["qty.", "qty", "quantity", "units", "shares", "holding qty", "net qty", "netqty"];
const AVG = ["avg. cost", "avg cost", "avg price", "average price", "avg. price", "buy avg", "average cost", "avg", "cost"];
const LTP = ["ltp", "last traded", "last price", "cmp", "current price", "last traded price", "market price"];
const ISIN = ["isin"];
const EXCH = ["exchange", "exch"];
// If these are present the file is a tradebook, not a snapshot → let a tradebook adapter handle it.
const TRADEBOOK_MARKERS = ["trade_type", "tradetype", "trade type", "buysell", "buy/sell", "side", "action", "trade_date", "tradedate", "trade date", "date(utc)"];

/** Parse a possibly comma-grouped / quoted / %-suffixed number (Indian formats included). */
function num(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.replace(/[,"%\s₹]/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const holdingsAdapter: BrokerAdapter = {
  id: "holdings",
  label: "Current holdings (snapshot)",

  detect(csv: ParsedCsv): DetectResult {
    const core = hasHeader(csv.headers, NAME) && hasHeader(csv.headers, QTY) && hasHeader(csv.headers, AVG);
    const isTradebook = hasHeader(csv.headers, TRADEBOOK_MARKERS);
    const confidence = core && !isTradebook ? 0.7 : 0;
    return {
      broker: "holdings",
      confidence,
      reason: core ? (isTradebook ? "Looks like a tradebook, not a holdings snapshot" : "Recognized a holdings/portfolio snapshot") : "Missing instrument/quantity/average-cost columns",
    };
  },

  normalize(csv: ParsedCsv): NormalizedRow[] {
    return csv.rows.map((raw, i): NormalizedRow => {
      const rowIndex = i;
      const name = pick(raw, NAME);
      const qty = num(pick(raw, QTY));
      const avg = num(pick(raw, AVG));

      if (!name) return { ok: false, error: "Missing instrument/name", raw, rowIndex };
      if (qty == null || qty <= 0) return { ok: false, error: `Invalid quantity '${pick(raw, QTY) ?? ""}'`, raw, rowIndex };
      if (avg == null || avg <= 0) return { ok: false, error: `Invalid average cost '${pick(raw, AVG) ?? ""}'`, raw, rowIndex };

      const symbol = name.toUpperCase();
      const ltp = num(pick(raw, LTP));
      // Hash on the stable identity (symbol+qty+avg), not the volatile last price, so re-importing
      // an updated snapshot with the same positions stays idempotent.
      const rawHash = rowHash("holdings", `${symbol}|${qty}|${avg}`);

      return {
        ok: true,
        rowIndex,
        rawHash,
        tx: {
          security: { symbol, name, isin: pick(raw, ISIN), assetClass: "equity", exchange: pick(raw, EXCH)?.toUpperCase() },
          type: "buy",
          tradeDate: new Date().toISOString(),
          quantity: String(qty),
          price: String(avg),
          grossAmount: String(qty * avg),
          fees: "0",
          taxes: "0",
          currency: "INR",
          segment: "equity",
          quotePrice: ltp != null && ltp > 0 ? String(ltp) : undefined,
        },
      };
    });
  },
};
