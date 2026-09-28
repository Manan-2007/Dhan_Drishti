import type { MarketDataProvider, SecurityLike, QuoteData } from "../types.js";

/**
 * AMFI daily NAV for Indian mutual funds (free public text file, no key). Maps a fund's
 * AMFI scheme code → latest NAV. Only used for securities with an amfiCode.
 */
export class AmfiProvider implements MarketDataProvider {
  id = "amfi";
  private cache: { at: number; map: Map<string, { nav: string; date: string }>; byIsin: Map<string, string> } | null = null;

  constructor(
    private url = "https://www.amfiindia.com/spages/NAVAll.txt",
    private ttlMs = 6 * 60 * 60 * 1000,
    private timeoutMs = 12000,
  ) {}

  private async load(): Promise<Map<string, { nav: string; date: string }>> {
    return (await this.loadAll()).map;
  }

  private async loadAll() {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`AMFI ${res.status}`);
      const text = await res.text();
      this.cache = { at: Date.now(), map: this.parse(text), byIsin: this.parseIsins(text) };
      return this.cache;
    } finally {
      clearTimeout(t);
    }
  }

  /** Lines look like: code;isin1;isin2;name;nav;date  (header/blank/section lines ignored). */
  parse(text: string): Map<string, { nav: string; date: string }> {
    const map = new Map<string, { nav: string; date: string }>();
    for (const line of text.split(/\r?\n/)) {
      const parts = line.split(";");
      if (parts.length < 6) continue;
      const code = parts[0]!.trim();
      const nav = parts[4]!.trim();
      const date = parts[5]!.trim();
      if (!/^\d+$/.test(code)) continue;
      if (!nav || Number.isNaN(Number(nav))) continue;
      map.set(code, { nav, date });
    }
    return map;
  }

  /** The file lists each scheme's growth and reinvestment ISINs: ISIN → scheme code. */
  parseIsins(text: string): Map<string, string> {
    const byIsin = new Map<string, string>();
    for (const line of text.split(/\r?\n/)) {
      const parts = line.split(";");
      if (parts.length < 6 || !/^\d+$/.test(parts[0]!.trim())) continue;
      for (const isin of [parts[1], parts[2]]) if (isin && /^INF[A-Z0-9]{9}$/.test(isin.trim())) byIsin.set(isin.trim(), parts[0]!.trim());
    }
    return byIsin;
  }

  /** A fund's AMFI scheme code from its ISIN (brokers give the ISIN, not the code). */
  async codeForIsin(isin: string): Promise<string | null> {
    try {
      return (await this.loadAll()).byIsin.get(isin.trim().toUpperCase()) ?? null;
    } catch {
      return null;
    }
  }

  async getQuotes(securities: SecurityLike[]): Promise<QuoteData[]> {
    const mfs = securities.filter((s) => s.amfiCode || (s.assetClass === "mf" && s.isin));
    if (mfs.length === 0) return [];
    const { map, byIsin } = await this.loadAll();
    const out: QuoteData[] = [];
    for (const s of mfs) {
      const code = s.amfiCode ? String(s.amfiCode) : byIsin.get(String(s.isin));
      const hit = code ? map.get(code) : undefined;
      if (!hit) continue;
      const parsed = new Date(`${hit.date} UTC`);
      out.push({
        securityId: s.id,
        price: hit.nav,
        prevClose: null,
        currency: s.currency,
        asOf: Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString(),
        provider: this.id,
      });
    }
    return out;
  }
}
