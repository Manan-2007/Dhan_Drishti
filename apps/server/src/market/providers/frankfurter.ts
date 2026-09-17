import type { FxProvider } from "../types.js";

/**
 * FX rates via frankfurter.app (ECB data, free, no key). getRate(from, to) returns how many
 * units of `to` one unit of `from` buys. Only public currency codes are sent.
 */
export class FrankfurterProvider implements FxProvider {
  id = "frankfurter";
  constructor(private timeoutMs = 8000) {}

  async getRate(from: string, to: string): Promise<string | null> {
    return this.fetchRate("latest", from, to);
  }

  /** Historical rate on `dateISO` (falls back to the nearest prior business day, per ECB). */
  async getRateOn(from: string, to: string, dateISO: string): Promise<string | null> {
    if (from === to) return "1";
    const day = dateISO.slice(0, 10);
    return this.fetchRate(day, from, to);
  }

  private async fetchRate(path: string, from: string, to: string): Promise<string | null> {
    if (from === to) return "1";
    const url = `https://api.frankfurter.app/${path}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      const json = (await res.json()) as { rates?: Record<string, number> };
      const rate = json.rates?.[to];
      return rate != null && Number.isFinite(rate) ? String(rate) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }
}
