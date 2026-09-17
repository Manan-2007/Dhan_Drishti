/** A security as seen by a market-data provider (only public identifiers — never holdings). */
export interface SecurityLike {
  id: string;
  symbol: string;
  isin?: string | null;
  amfiCode?: string | null;
  assetClass: string;
  exchange?: string | null;
  currency: string;
}

export interface QuoteData {
  securityId: string;
  price: string;
  prevClose?: string | null;
  currency: string;
  asOf: string; // ISO-8601 UTC
  provider: string;
}

/**
 * A pluggable price source. The app core never imports a concrete provider — it depends
 * only on this interface, so providers (Yahoo, AMFI, a future one) can be swapped freely.
 * Providers receive only public symbols/ISINs, never any portfolio or user data.
 */
export interface MarketDataProvider {
  id: string;
  getQuotes(securities: SecurityLike[]): Promise<QuoteData[]>;
}

/** FX rate source (kept separate from equity/MF quotes). */
export interface FxProvider {
  id: string;
  getRate(base: string, quote: string): Promise<string | null>;
  /** Optional historical rate on a specific date (YYYY-MM-DD) — for FX-at-cost capture. */
  getRateOn?(base: string, quote: string, dateISO: string): Promise<string | null>;
}

/** One historical index bar (calendar day + close). */
export interface BenchmarkBar {
  date: string; // YYYY-MM-DD
  close: number;
}

/**
 * Historical index-price source for benchmark comparison. Receives only a public index
 * symbol (e.g. `^NSEI`) and a date range — never any portfolio or user data.
 */
export interface BenchmarkProvider {
  id: string;
  getHistory(symbol: string, fromISO: string, toISO: string): Promise<BenchmarkBar[]>;
}

/**
 * Historical daily prices for an individual security (for time-weighted return). Receives
 * only the public ticker/exchange — never holdings. Returns [] when unavailable (e.g. MFs).
 */
export interface SecurityHistoryProvider {
  id: string;
  getHistory(security: SecurityLike, fromISO: string, toISO: string): Promise<BenchmarkBar[]>;
}
