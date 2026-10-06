/**
 * Company fundamentals from Yahoo's quoteSummary — market cap, valuation multiples, margins,
 * growth and analyst targets. Since 2023 this endpoint needs a cookie + crumb handshake, so the
 * provider does that once and reuses it, re-handshaking on a 401. Only the public ticker is sent.
 *
 * Yahoo rate-limits and occasionally changes this, so everything degrades gracefully: any failure
 * returns the last cached value (or null), never a throw and never a fabricated figure. Results are
 * cached in memory for `ttlMs` (a day) because fundamentals move slowly and a quota is precious.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface Fundamentals {
  currency: string | null;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  pegRatio: number | null;
  profitMargin: number | null; // fraction, e.g. 0.21
  operatingMargin: number | null;
  revenueGrowth: number | null; // yoy fraction
  earningsGrowth: number | null; // yoy fraction
  returnOnEquity: number | null;
  dividendYield: number | null; // fraction
  eps: number | null; // trailing
  bookValue: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
  dayLow: number | null;
  dayHigh: number | null;
  targetMeanPrice: number | null;
  recommendationKey: string | null; // "buy" | "hold" | "sell" | …
  numberOfAnalysts: number | null;
  asOf: string; // ISO time this was fetched
}

export interface FundamentalsProvider {
  getFundamentals(ticker: string): Promise<Fundamentals | null>;
}

type Node = Record<string, { raw?: number | string } | undefined> | undefined;
const num = (n: Node, key: string): number | null => {
  const raw = n?.[key]?.raw;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
};
const str = (n: Node, key: string): string | null => {
  const raw = n?.[key]?.raw;
  return typeof raw === "string" && raw ? raw : null;
};

/** Normalize a quoteSummary result object into our flat shape. Exported for tests (no network). */
export function parseFundamentals(result: Record<string, unknown>, asOf = new Date().toISOString()): Fundamentals {
  const sd = result.summaryDetail as Node;
  const ks = result.defaultKeyStatistics as Node;
  const fd = result.financialData as Node;
  const price = result.price as Node;
  return {
    currency: str(price, "currency") ?? str(sd, "currency"),
    marketCap: num(sd, "marketCap") ?? num(price, "marketCap"),
    trailingPE: num(sd, "trailingPE"),
    forwardPE: num(sd, "forwardPE") ?? num(ks, "forwardPE"),
    priceToBook: num(ks, "priceToBook"),
    pegRatio: num(ks, "pegRatio"),
    profitMargin: num(fd, "profitMargins") ?? num(ks, "profitMargins"),
    operatingMargin: num(fd, "operatingMargins"),
    revenueGrowth: num(fd, "revenueGrowth"),
    earningsGrowth: num(fd, "earningsGrowth") ?? num(ks, "earningsQuarterlyGrowth"),
    returnOnEquity: num(fd, "returnOnEquity"),
    dividendYield: num(sd, "dividendYield"),
    eps: num(ks, "trailingEps"),
    bookValue: num(ks, "bookValue"),
    fiftyTwoWeekLow: num(sd, "fiftyTwoWeekLow"),
    fiftyTwoWeekHigh: num(sd, "fiftyTwoWeekHigh"),
    dayLow: num(sd, "dayLow"),
    dayHigh: num(sd, "dayHigh"),
    targetMeanPrice: num(fd, "targetMeanPrice"),
    recommendationKey: str(fd, "recommendationKey"),
    numberOfAnalysts: num(fd, "numberOfAnalystOpinions"),
    asOf,
  };
}

export class YahooFundamentalsProvider implements FundamentalsProvider {
  private cookie: string | null = null;
  private crumb: string | null = null;
  private cache = new Map<string, { value: Fundamentals; at: number }>();

  constructor(
    private ttlMs = 12 * 3600_000,
    private timeoutMs = 8000,
  ) {}

  private async withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await fn(ctrl.signal);
    } finally {
      clearTimeout(t);
    }
  }

  /** Fetch a session cookie from a Yahoo page, then a crumb for it. Best-effort. */
  private async handshake(): Promise<void> {
    await this.withTimeout(async (signal) => {
      const res = await fetch("https://finance.yahoo.com/", { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal });
      const set = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
      const cookie = set.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
      if (cookie) this.cookie = cookie;
    });
    await this.withTimeout(async (signal) => {
      const res = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { "user-agent": UA, cookie: this.cookie ?? "" }, signal });
      const crumb = (await res.text()).trim();
      if (crumb && !/\s/.test(crumb) && crumb.length <= 40) this.crumb = crumb;
      else this.crumb = null;
    });
  }

  private async fetchOnce(ticker: string): Promise<Fundamentals | null | "unauthorized"> {
    if (!this.crumb || !this.cookie) return "unauthorized";
    const modules = "summaryDetail,defaultKeyStatistics,financialData,price";
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}&crumb=${encodeURIComponent(this.crumb)}`;
    return this.withTimeout(async (signal) => {
      const res = await fetch(url, { headers: { "user-agent": UA, cookie: this.cookie! }, signal });
      if (res.status === 401 || res.status === 403) return "unauthorized";
      if (!res.ok) return null;
      const json = (await res.json()) as { quoteSummary?: { result?: Record<string, unknown>[] } };
      const result = json.quoteSummary?.result?.[0];
      return result ? parseFundamentals(result) : null;
    });
  }

  async getFundamentals(ticker: string): Promise<Fundamentals | null> {
    const hit = this.cache.get(ticker);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    try {
      if (!this.crumb || !this.cookie) await this.handshake();
      let data = await this.fetchOnce(ticker);
      if (data === "unauthorized") {
        await this.handshake(); // crumb expired or missing — try once more
        data = await this.fetchOnce(ticker);
      }
      if (data && data !== "unauthorized") {
        this.cache.set(ticker, { value: data, at: Date.now() });
        return data;
      }
      return hit?.value ?? null; // keep the last good value through a failure
    } catch {
      return hit?.value ?? null;
    }
  }
}
