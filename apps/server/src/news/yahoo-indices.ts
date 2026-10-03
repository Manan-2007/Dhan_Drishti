import type { IndexQuote, IndexSource } from "./types.js";

/** The numbers an Indian investor glances at. Yahoo symbols, public. `INR=X` is USD→INR. */
export const INDICES = [
  { id: "nifty50", name: "Nifty 50", symbol: "^NSEI" },
  { id: "banknifty", name: "Bank Nifty", symbol: "^NSEBANK" },
  { id: "sensex", name: "Sensex", symbol: "^BSESN" },
  { id: "usdinr", name: "USD / INR", symbol: "INR=X" },
] as const;

/** Live index values from Yahoo's public chart endpoint (no key). */
export class YahooIndexSource implements IndexSource {
  constructor(private timeoutMs = 6000) {}

  private async one(ix: (typeof INDICES)[number]): Promise<IndexQuote | null> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ix.symbol)}?interval=1d&range=1d`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        chart?: { result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; regularMarketTime?: number } }[] };
      };
      const meta = json.chart?.result?.[0]?.meta;
      const value = meta?.regularMarketPrice;
      if (value == null || !Number.isFinite(value)) return null;
      const prev = meta?.previousClose ?? meta?.chartPreviousClose ?? null;
      const change = prev ? value - prev : null;
      return {
        id: ix.id,
        name: ix.name,
        value,
        change,
        changePct: prev && change !== null ? (change / prev) * 100 : null,
        asOf: new Date((meta?.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
      };
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  async getIndices(): Promise<IndexQuote[]> {
    const got = await Promise.all(INDICES.map((ix) => this.one(ix)));
    return got.filter((q): q is IndexQuote => q !== null);
  }
}
