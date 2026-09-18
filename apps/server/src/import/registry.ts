import type { BrokerAdapter, ParsedCsv, DetectResult } from "./types.js";
import { zerodhaAdapter } from "./adapters/zerodha.js";
import { dhanAdapter } from "./adapters/dhan.js";
import { vestedAdapter } from "./adapters/vested.js";
import { ibkrAdapter } from "./adapters/ibkr.js";
import { binanceAdapter } from "./adapters/binance.js";
import { holdingsAdapter } from "./adapters/holdings.js";
import { zerodhaHoldingsAdapter } from "./adapters/zerodha-holdings.js";
import { dhanTxnAdapter } from "./adapters/dhan-txn.js";
import { fundsAdapter } from "./adapters/funds.js";
import { dividendsAdapter } from "./adapters/dividends.js";
import { makeGenericAdapter, type GenericMapping } from "./adapters/generic.js";

const ADAPTERS: Record<string, BrokerAdapter> = {
  [zerodhaAdapter.id]: zerodhaAdapter,
  [zerodhaHoldingsAdapter.id]: zerodhaHoldingsAdapter,
  [dhanTxnAdapter.id]: dhanTxnAdapter,
  [dhanAdapter.id]: dhanAdapter,
  [vestedAdapter.id]: vestedAdapter,
  [ibkrAdapter.id]: ibkrAdapter,
  [binanceAdapter.id]: binanceAdapter,
  [holdingsAdapter.id]: holdingsAdapter,
  [fundsAdapter.id]: fundsAdapter,
  [dividendsAdapter.id]: dividendsAdapter,
};

/** Adapters that need a per-request configuration (not fixed singletons). */
const CONFIGURABLE = new Set(["generic"]);

export function getAdapter(id: string, mapping?: GenericMapping): BrokerAdapter | undefined {
  if (id === "generic") return mapping ? makeGenericAdapter(mapping) : undefined;
  return ADAPTERS[id];
}

export interface AdapterInfo {
  id: string;
  label: string;
  configurable: boolean;
  /** "transactions" → the normal import pipeline; "prices" → a price-only seed (no cost basis). */
  kind: "transactions" | "prices";
}

export function listAdapters(): AdapterInfo[] {
  const fixed: AdapterInfo[] = Object.values(ADAPTERS).map((a) => ({ id: a.id, label: a.label, configurable: false, kind: "transactions" }));
  return [
    ...fixed,
    { id: "dhan-holdings", label: "Dhan — Holdings (update current prices)", configurable: false, kind: "prices" },
    { id: "generic", label: "Generic CSV (custom mapping)", configurable: true, kind: "transactions" },
  ];
}

export { CONFIGURABLE };

/** Pick the highest-confidence adapter for a parsed file. */
export function detectBest(csv: ParsedCsv): DetectResult | null {
  let best: DetectResult | null = null;
  for (const a of Object.values(ADAPTERS)) {
    const r = a.detect(csv);
    if (r.confidence > 0 && (!best || r.confidence > best.confidence)) best = r;
  }
  return best;
}
