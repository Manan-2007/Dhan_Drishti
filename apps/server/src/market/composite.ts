import type { MarketDataProvider, SecurityLike, QuoteData } from "./types.js";

/**
 * Routes each security to the right provider by asset class: mutual funds (with an AMFI
 * code) → AMFI, everything else → the equities provider. Failures in one provider don't
 * sink the others.
 */
export class CompositeProvider implements MarketDataProvider {
  id = "composite";
  constructor(
    private equities: MarketDataProvider,
    private funds: MarketDataProvider,
  ) {}

  async getQuotes(securities: SecurityLike[]): Promise<QuoteData[]> {
    const mf: SecurityLike[] = [];
    const rest: SecurityLike[] = [];
    for (const s of securities) {
      if (s.assetClass === "mf" && s.amfiCode) mf.push(s);
      else rest.push(s);
    }
    const [a, b] = await Promise.allSettled([this.equities.getQuotes(rest), this.funds.getQuotes(mf)]);
    const out: QuoteData[] = [];
    if (a.status === "fulfilled") out.push(...a.value);
    if (b.status === "fulfilled") out.push(...b.value);
    return out;
  }
}
