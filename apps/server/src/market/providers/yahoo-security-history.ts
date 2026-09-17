import type { SecurityHistoryProvider, SecurityLike, BenchmarkBar } from "../types.js";
import { YahooBenchmarkProvider } from "./yahoo-benchmark.js";

/**
 * Historical daily closes for an individual security from Yahoo (no key). Maps the security to
 * a Yahoo ticker exactly like the live quote provider (NSE `.NS`, BSE `.BO`, crypto `-USD`),
 * then delegates to the shared chart fetch. Mutual funds (AMFI) have no Yahoo history → []
 * so time-weighted return honestly reports them as uncovered rather than guessing.
 */
export class YahooSecurityHistoryProvider implements SecurityHistoryProvider {
  id = "yahoo";
  private chart: YahooBenchmarkProvider;
  constructor(timeoutMs = 10000) {
    this.chart = new YahooBenchmarkProvider(timeoutMs);
  }

  private ysym(s: SecurityLike): string | null {
    const sym = s.symbol.trim().toUpperCase();
    if (!sym) return null;
    if (s.assetClass === "mf") return null; // no equity-style history feed for MFs
    if (s.assetClass === "crypto") return `${sym}-USD`;
    const ex = (s.exchange ?? "").toUpperCase();
    if (ex === "NSE") return `${sym}.NS`;
    if (ex === "BSE") return `${sym}.BO`;
    if (s.currency === "INR") return `${sym}.NS`;
    return sym;
  }

  async getHistory(security: SecurityLike, fromISO: string, toISO: string): Promise<BenchmarkBar[]> {
    const sym = this.ysym(security);
    if (!sym) return [];
    return this.chart.getHistory(sym, fromISO, toISO);
  }
}
