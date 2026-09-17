import type { BenchmarkProvider, BenchmarkBar } from "../types.js";

/**
 * Historical index closes from Yahoo Finance (unofficial public chart endpoint, no API key).
 * Only the public index symbol and a date range are sent. Used for benchmark comparison.
 */
export class YahooBenchmarkProvider implements BenchmarkProvider {
  id = "yahoo";
  constructor(private timeoutMs = 10000) {}

  async getHistory(symbol: string, fromISO: string, toISO: string): Promise<BenchmarkBar[]> {
    const period1 = Math.floor(new Date(fromISO).getTime() / 1000);
    const period2 = Math.floor(new Date(toISO).getTime() / 1000) + 86_400; // inclusive of the end day
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?period1=${period1}&period2=${period2}&interval=1d`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok) return [];
      const json = (await res.json()) as {
        chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
      };
      const result = json.chart?.result?.[0];
      const stamps = result?.timestamp;
      const closes = result?.indicators?.quote?.[0]?.close;
      if (!stamps || !closes) return [];
      const bars: BenchmarkBar[] = [];
      for (let i = 0; i < stamps.length; i++) {
        const c = closes[i];
        if (c == null || !Number.isFinite(c)) continue; // Yahoo emits null for non-trading days
        bars.push({ date: new Date(stamps[i]! * 1000).toISOString().slice(0, 10), close: c });
      }
      bars.sort((a, b) => (a.date < b.date ? -1 : 1));
      return bars;
    } catch {
      return [];
    } finally {
      clearTimeout(t);
    }
  }
}
