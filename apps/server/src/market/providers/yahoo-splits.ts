import { d } from "@dhan-drishti/core";
import type { SecurityLike, SplitEvent, SplitSource } from "../types.js";

interface ChartSplits {
  chart?: { result?: { events?: { splits?: Record<string, { date?: number; numerator?: number; denominator?: number; splitRatio?: string }> } }[] | null };
}

/**
 * Splits from Yahoo Finance's public chart endpoint (no key): the whole history in one small
 * request. Only the ticker is sent. Indian shares are looked up on NSE, then BSE — the same
 * listing order the price history uses. Bonus issues come through as splits (a 1:1 bonus is 2:1).
 */
export class YahooSplitSource implements SplitSource {
  id = "yahoo";
  constructor(private timeoutMs = 10000) {}

  private tickers(s: SecurityLike): string[] {
    const sym = s.symbol.trim().toUpperCase();
    if (!sym) return [];
    const ex = (s.exchange ?? "").toUpperCase();
    if (s.currency === "INR" || ex === "NSE" || ex === "BSE") return ex === "BSE" ? [`${sym}.BO`, `${sym}.NS`] : [`${sym}.NS`, `${sym}.BO`];
    return [sym];
  }

  async getSplits(security: SecurityLike): Promise<SplitEvent[] | null> {
    let reached = false;
    for (const t of this.tickers(security)) {
      const r = await this.fetchSplits(t);
      if (r === null) continue;
      reached = true;
      if (r.found) return r.splits;
    }
    return reached ? [] : null;
  }

  /** null: couldn't reach Yahoo; found=false: Yahoo doesn't know this ticker. */
  private async fetchSplits(ticker: string): Promise<{ found: boolean; splits: SplitEvent[] } | null> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=max&interval=3mo&events=split`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0" } });
      if (res.status === 404) return { found: false, splits: [] };
      if (!res.ok) return null;
      const json = (await res.json()) as ChartSplits;
      const result = json.chart?.result?.[0];
      if (!result) return { found: false, splits: [] };
      const splits: SplitEvent[] = [];
      for (const e of Object.values(result.events?.splits ?? {})) {
        const n = e.numerator;
        const dnm = e.denominator;
        if (!e.date || !n || !dnm || !(n > 0) || !(dnm > 0) || n === dnm) continue;
        // The event is stamped at the market's open on the day it took effect.
        splits.push({ exDate: new Date(e.date * 1000).toISOString().slice(0, 10), ratio: d(n).div(dnm).toFixed(), label: e.splitRatio ?? `${n}:${dnm}` });
      }
      return { found: true, splits: splits.sort((a, b) => (a.exDate < b.exDate ? -1 : 1)) };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
