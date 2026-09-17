import type { AssetClass } from "@dhan-drishti/core";
import type { BrokerAdapter, ParsedCsv, NormalizedRow, DetectResult } from "../types.js";
import { pick, rowHash } from "../csv.js";

/**
 * User-defined column mapping — a reusable "import template" that lets any broker CSV be
 * imported without a bespoke adapter. Values are source column names.
 */
export interface GenericMapping {
  symbol: string;
  name?: string;
  isin?: string;
  date: string;
  type: string;
  quantity: string;
  price: string;
  amount?: string;
  fees?: string;
  taxes?: string;
  currency?: string; // default INR
  assetClass?: AssetClass; // default equity
  buyValues?: string[]; // default ['buy','b']
  sellValues?: string[]; // default ['sell','s']
}

function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const dmy = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  const iso = dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : raw;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function makeGenericAdapter(mapping: GenericMapping): BrokerAdapter {
  const buys = (mapping.buyValues ?? ["buy", "b"]).map((v) => v.toLowerCase());
  const sells = (mapping.sellValues ?? ["sell", "s"]).map((v) => v.toLowerCase());
  const currency = mapping.currency ?? "INR";
  const assetClass = mapping.assetClass ?? "equity";

  const val = (row: Record<string, string>, col?: string) => (col ? pick(row, [col]) : undefined);
  const normType = (raw: string | undefined): "buy" | "sell" | null => {
    const s = (raw ?? "").toLowerCase().trim();
    if (buys.includes(s)) return "buy";
    if (sells.includes(s)) return "sell";
    return null;
  };

  return {
    id: "generic",
    label: "Generic CSV (custom mapping)",

    detect(csv: ParsedCsv): DetectResult {
      const lower = new Set(csv.headers.map((h) => h.toLowerCase().trim()));
      const need = [mapping.symbol, mapping.date, mapping.type, mapping.quantity, mapping.price];
      const missing = need.filter((c) => !lower.has(c.toLowerCase().trim()));
      return {
        broker: "generic",
        confidence: missing.length === 0 ? 0.8 : 0,
        reason: missing.length === 0 ? "All mapped columns present" : `Missing mapped columns: ${missing.join(", ")}`,
      };
    },

    normalize(csv: ParsedCsv): NormalizedRow[] {
      return csv.rows.map((raw, i): NormalizedRow => {
        const rowIndex = i;
        const symbol = val(raw, mapping.symbol);
        const type = normType(val(raw, mapping.type));
        const qty = val(raw, mapping.quantity);
        const price = val(raw, mapping.price);
        const tradeDate = parseDate(val(raw, mapping.date));

        if (!symbol) return { ok: false, error: "Missing symbol", raw, rowIndex };
        if (!type) return { ok: false, error: `Unrecognized type '${val(raw, mapping.type) ?? ""}'`, raw, rowIndex };
        if (!qty || !Number.isFinite(Number(qty)) || Number(qty) <= 0) return { ok: false, error: `Invalid quantity '${qty ?? ""}'`, raw, rowIndex };
        if (!price || !Number.isFinite(Number(price))) return { ok: false, error: `Invalid price '${price ?? ""}'`, raw, rowIndex };
        if (!tradeDate) return { ok: false, error: `Invalid date '${val(raw, mapping.date) ?? ""}'`, raw, rowIndex };

        const amount = val(raw, mapping.amount);
        const fees = val(raw, mapping.fees);
        const taxes = val(raw, mapping.taxes);
        const grossAmount = amount && Number.isFinite(Number(amount)) ? String(Number(amount)) : String(Number(qty) * Number(price));

        return {
          ok: true,
          rowIndex,
          rawHash: rowHash("generic", csv.rawLines[i] ?? `${symbol}|${tradeDate}|${type}|${qty}|${price}`),
          tx: {
            security: { symbol: symbol.toUpperCase(), name: val(raw, mapping.name), isin: val(raw, mapping.isin), assetClass, exchange: undefined },
            type,
            tradeDate,
            quantity: String(Number(qty)),
            price: String(Number(price)),
            grossAmount,
            fees: fees && Number.isFinite(Number(fees)) ? String(Number(fees)) : "0",
            taxes: taxes && Number.isFinite(Number(taxes)) ? String(Number(taxes)) : "0",
            currency,
            segment: "equity",
          },
        };
      });
    },
  };
}
