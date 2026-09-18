import type { AssetClass } from "@dhan-drishti/core";
import type { BrokerAdapter, ParsedCsv, NormalizedRow, DetectResult } from "../types.js";
import { pick, hasHeader, rowHash } from "../csv.js";

/**
 * Zerodha "Holdings Statement" (.xlsx) — the Console export with an Equity, a Mutual Funds and a
 * combined sheet, each carrying Average Price and Previous Closing Price. We turn every position
 * into a single `buy` at its average cost and seed the previous close as a quote so current value
 * shows immediately.
 *
 * Quantity is split across buckets. Reconciling every row against its Unrealized P&L
 * (qty = UPL ÷ (prevClose − avgCost)) shows the true holding is:
 *     Available + max(Long Term, Pledged Margin + Pledged Loan)
 * — pledged shares add to what's available, while "Long Term" is a status tag that overlaps the
 * pledged/available buckets (so it must not be summed on top). Missing columns (the MF sheet has
 * no Long Term column) count as 0.
 */
const SYMBOL = ["symbol", "tradingsymbol", "instrument", "scrip"];
const ISIN = ["isin", "isin code"];
const AVG = ["average price", "avg. cost", "avg cost", "average cost", "buy avg"];
const PREV_CLOSE = ["previous closing price", "closing price", "last price", "ltp", "close price"];
const AVAIL = ["quantity available", "quantity", "qty", "quantity avail."];
const LONG_TERM = ["quantity long term", "long term quantity"];
const PLEDGED_MARGIN = ["quantity pledged (margin)", "pledged quantity (margin)", "margin pledge"];
const PLEDGED_LOAN = ["quantity pledged (loan)", "pledged quantity (loan)", "loan pledge"];
const INSTRUMENT_TYPE = ["instrument type", "scheme type", "category"];

function num(raw: string | undefined): number {
  if (raw == null) return 0;
  const s = raw.replace(/[,"%\s₹$]/g, "").trim();
  if (s === "" || s === "-") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** A mutual-fund "Instrument Type" like "Equity - Small Cap" or "Debt - Medium Duration" →
 *  [sector, subSector] for the allocation breakdown. */
function fundCategory(instrumentType: string): { sector: string; subSector?: string } {
  const parts = instrumentType.split(/\s[-–]\s/).map((p) => p.trim()).filter(Boolean);
  const sector = parts[0] || instrumentType.trim();
  return { sector, subSector: parts[1] };
}

export const zerodhaHoldingsAdapter: BrokerAdapter = {
  id: "zerodha-holdings",
  label: "Zerodha — Holdings statement (.xlsx)",

  detect(csv: ParsedCsv): DetectResult {
    const core = hasHeader(csv.headers, SYMBOL) && hasHeader(csv.headers, AVG) && hasHeader(csv.headers, AVAIL);
    const hint = hasHeader(csv.headers, PREV_CLOSE) && hasHeader(csv.headers, ["unrealized p&l", "unrealised p&l", "unrealized p&l pct.", "unrealize p&l pct."]);
    const confidence = core ? (hint ? 0.85 : 0.5) : 0;
    return {
      broker: "zerodha-holdings",
      confidence,
      reason: core ? "Recognized a Zerodha holdings statement" : "Missing symbol / average-price / quantity columns",
    };
  },

  normalize(csv: ParsedCsv): NormalizedRow[] {
    const out: NormalizedRow[] = [];
    csv.rows.forEach((raw, i) => {
      const symbol = pick(raw, SYMBOL)?.trim();
      if (!symbol) return; // blank / summary / separator row → skip silently

      const avg = num(pick(raw, AVG));
      const qty = num(pick(raw, AVAIL)) + Math.max(num(pick(raw, LONG_TERM)), num(pick(raw, PLEDGED_MARGIN)) + num(pick(raw, PLEDGED_LOAN)));
      if (qty <= 0) return; // fully exited / non-position row
      if (avg <= 0) {
        out.push({ ok: false, error: `Invalid average price '${pick(raw, AVG) ?? ""}'`, raw, rowIndex: i });
        return;
      }

      const instrumentType = pick(raw, INSTRUMENT_TYPE);
      const isFund = !!instrumentType && instrumentType.trim() !== "-";
      let assetClass: AssetClass = isFund ? "mf" : "equity";
      let sector: string | undefined;
      let subSector: string | undefined;
      if (isFund) {
        // The fund category is authoritative for MFs (e.g. a liquid/overnight fund is Debt).
        const cat = fundCategory(instrumentType!);
        sector = cat.sector;
        subSector = cat.subSector;
        if (/liquid|overnight|money market/i.test(instrumentType!)) sector = "Debt";
      }
      // Equity sector is left to the built-in classifier (consistent taxonomy across brokers).

      const prevClose = num(pick(raw, PREV_CLOSE));
      out.push({
        ok: true,
        rowIndex: i,
        // Stable identity (symbol+qty+avg), not the volatile close, so re-importing an updated
        // snapshot with the same positions stays idempotent.
        rawHash: rowHash("zerodha-holdings", `${symbol.toUpperCase()}|${qty}|${avg}`),
        tx: {
          security: { symbol: symbol.toUpperCase(), name: symbol, isin: pick(raw, ISIN), assetClass, sector, subSector },
          type: "buy",
          tradeDate: new Date().toISOString(),
          quantity: String(qty),
          price: String(avg),
          grossAmount: String(qty * avg),
          fees: "0",
          taxes: "0",
          currency: "INR",
          segment: isFund ? "mf" : "equity",
          quotePrice: prevClose > 0 ? String(prevClose) : undefined,
        },
      });
    });
    return out;
  },
};
