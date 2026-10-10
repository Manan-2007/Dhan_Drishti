import type { BenchmarkBar } from "../types.js";
import { YahooBenchmarkProvider } from "./yahoo-benchmark.js";

/** A listed share or ETF found by name or symbol (India: NSE/BSE; US). */
export interface TickerHit {
  ticker: string; // Yahoo form: RELIANCE.NS, RELIANCE.BO, PLTR
  name: string;
  exchange: string;
  market: "in" | "us";
  type: "Equity" | "ETF";
}

export interface TickerQuote {
  ticker: string;
  name: string;
  currency: string;
  exchange: string;
  price: number | null;
  prevClose: number | null;
  asOf: string | null;
}

/**
 * Public lookups for any listed stock, held or not — for search and research. Only the typed text or
 * a public ticker is sent; nothing about holdings.
 */
export interface TickerSource {
  id: string;
  /** null: couldn't reach the source. */
  search(q: string): Promise<TickerHit[] | null>;
  quote(ticker: string): Promise<TickerQuote | null>;
  history(ticker: string, fromISO: string, toISO: string): Promise<BenchmarkBar[]>;
}

/** India (NSE `.NS`, BSE `.BO`) and plain US tickers — the markets the app covers. */
export const TICKER_RE = /^[A-Z0-9&-]{1,15}(\.(NS|BO))?$/;
export const marketOf = (ticker: string): "in" | "us" => (/\.(NS|BO)$/.test(ticker) ? "in" : "us");

async function getJson<T>(url: string, timeoutMs: number): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const EXCHANGE: Record<string, string> = { NSI: "NSE", BSE: "BSE", NMS: "NASDAQ", NGM: "NASDAQ", NCM: "NASDAQ", NYQ: "NYSE", ASE: "NYSE American", PCX: "NYSE Arca", BTS: "Cboe" };

export class YahooTickerSource implements TickerSource {
  id = "yahoo";
  private chart: YahooBenchmarkProvider;
  constructor(private timeoutMs = 8000) {
    this.chart = new YahooBenchmarkProvider(timeoutMs);
  }

  async search(q: string): Promise<TickerHit[] | null> {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0`;
    const json = await getJson<{ quotes?: { symbol?: string; shortname?: string; longname?: string; exchange?: string; quoteType?: string }[] }>(url, this.timeoutMs);
    if (!json) return null;
    const hits: TickerHit[] = [];
    for (const r of json.quotes ?? []) {
      const ticker = (r.symbol ?? "").toUpperCase();
      if (!TICKER_RE.test(ticker) || (r.quoteType !== "EQUITY" && r.quoteType !== "ETF")) continue;
      const exchange = EXCHANGE[r.exchange ?? ""];
      if (!exchange) continue; // another market (London, Toronto, …)
      hits.push({ ticker, name: r.longname || r.shortname || ticker, exchange, market: marketOf(ticker), type: r.quoteType === "ETF" ? "ETF" : "Equity" });
    }
    return hits;
  }

  async quote(ticker: string): Promise<TickerQuote | null> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d`;
    const json = await getJson<{
      chart?: { result?: { meta?: { currency?: string; longName?: string; shortName?: string; fullExchangeName?: string; exchangeName?: string; regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; regularMarketTime?: number } }[] | null };
    }>(url, this.timeoutMs);
    const m = json?.chart?.result?.[0]?.meta;
    if (!m || !m.currency) return null;
    const num = (v: number | undefined) => (v != null && Number.isFinite(v) ? v : null);
    return {
      ticker,
      name: m.longName || m.shortName || ticker,
      currency: m.currency,
      exchange: EXCHANGE[m.exchangeName ?? ""] ?? m.fullExchangeName ?? m.exchangeName ?? "",
      price: num(m.regularMarketPrice),
      prevClose: num(m.chartPreviousClose ?? m.previousClose),
      asOf: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    };
  }

  history(ticker: string, fromISO: string, toISO: string) {
    return this.chart.getHistory(ticker, fromISO, toISO);
  }
}
