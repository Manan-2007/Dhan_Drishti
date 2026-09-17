import type { MarketDataProvider, SecurityLike, QuoteData } from "../types.js";

/**
 * Yahoo Finance quotes (unofficial public endpoint, no API key). Only the public ticker
 * symbol is sent. Used for equities / ETFs / crypto; MFs go to AMFI instead.
 */
export class YahooProvider implements MarketDataProvider {
  id = "yahoo";
  constructor(private timeoutMs = 8000) {}

  /** Map an internal security to a Yahoo ticker (NSE .NS, BSE .BO, crypto -USD). */
  private ysym(s: SecurityLike): string | null {
    const sym = s.symbol.trim().toUpperCase();
    if (!sym) return null;
    if (s.assetClass === "crypto") return `${sym}-USD`;
    const ex = (s.exchange ?? "").toUpperCase();
    if (ex === "NSE") return `${sym}.NS`;
    if (ex === "BSE") return `${sym}.BO`;
    if (s.currency === "INR") return `${sym}.NS`; // default Indian listings to NSE
    return sym; // US / other listings
  }

  private async fetchOne(s: SecurityLike): Promise<QuoteData | null> {
    const ysym = this.ysym(s);
    if (!ysym) return null;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?interval=1d&range=1d`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        chart?: { result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; currency?: string } }[] };
      };
      const meta = json.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      if (price == null || !Number.isFinite(price)) return null;
      const prev = meta?.chartPreviousClose ?? meta?.previousClose;
      return {
        securityId: s.id,
        price: String(price),
        prevClose: prev != null && Number.isFinite(prev) ? String(prev) : null,
        currency: meta?.currency ?? s.currency,
        asOf: new Date().toISOString(),
        provider: this.id,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  async getQuotes(securities: SecurityLike[]): Promise<QuoteData[]> {
    const out: QuoteData[] = [];
    const CONCURRENCY = 6;
    for (let i = 0; i < securities.length; i += CONCURRENCY) {
      const batch = securities.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((s) => this.fetchOne(s)));
      for (const r of results) if (r) out.push(r);
    }
    return out;
  }
}
