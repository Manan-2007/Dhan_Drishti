import type { BenchmarkBar } from "../types.js";

/**
 * Daily NAV history for an Indian mutual fund from mfapi.in (free, public, no key), by AMFI scheme
 * code. Only the scheme code is sent — never holdings or amounts.
 */
export class MfApiHistoryProvider {
  id = "mfapi";
  constructor(private timeoutMs = 15000) {}

  async getHistory(schemeCode: string, fromISO: string, toISO: string): Promise<BenchmarkBar[]> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(schemeCode)}`, { signal: ctrl.signal });
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: { date: string; nav: string }[] };
      const from = fromISO.slice(0, 10);
      const to = toISO.slice(0, 10);
      const bars: BenchmarkBar[] = [];
      for (const row of json.data ?? []) {
        const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(row.date); // dd-mm-yyyy
        const close = Number(row.nav);
        if (!m || !Number.isFinite(close) || close <= 0) continue;
        const date = `${m[3]}-${m[2]}-${m[1]}`;
        if (date >= from && date <= to) bars.push({ date, close });
      }
      return bars.sort((a, b) => (a.date < b.date ? -1 : 1));
    } catch {
      return [];
    } finally {
      clearTimeout(t);
    }
  }
}
