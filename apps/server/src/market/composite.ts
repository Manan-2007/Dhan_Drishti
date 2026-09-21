import type { MarketDataProvider, SecurityLike, QuoteData } from "./types.js";

/**
 * Routes each security to the right provider by asset class: mutual funds (with an AMFI
 * code) → AMFI, F&O contracts (assetClass "other") → the derivative estimator (when given),
 * everything else → the equities provider. Failures in one provider don't sink the others.
 */
export class CompositeProvider implements MarketDataProvider {
  id = "composite";
  constructor(
    private equities: MarketDataProvider,
    private funds: MarketDataProvider,
    private derivatives?: MarketDataProvider,
  ) {}

  async getQuotes(securities: SecurityLike[]): Promise<QuoteData[]> {
    const mf: SecurityLike[] = [];
    const deriv: SecurityLike[] = [];
    const rest: SecurityLike[] = [];
    for (const s of securities) {
      if (s.assetClass === "mf" && s.amfiCode) mf.push(s);
      else if (s.assetClass === "other" && this.derivatives) deriv.push(s);
      else rest.push(s);
    }
    const [a, b, c] = await Promise.allSettled([
      this.equities.getQuotes(rest),
      this.funds.getQuotes(mf),
      this.derivatives ? this.derivatives.getQuotes(deriv) : Promise.resolve([]),
    ]);
    const out: QuoteData[] = [];
    if (a.status === "fulfilled") out.push(...a.value);
    if (b.status === "fulfilled") out.push(...b.value);
    if (c.status === "fulfilled") out.push(...c.value);
    return out;
  }
}
