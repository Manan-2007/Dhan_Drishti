import type { MarketDataProvider, SecurityLike, QuoteData, BenchmarkProvider } from "../types.js";
import { parseDerivativeSymbol, underlyingYahooSymbol } from "../derivative-symbol.js";
import { bsCall, bsPut, futuresFairValue, annualizedVolatility } from "../pricing/black-scholes.js";
import { YahooBenchmarkProvider } from "./yahoo-benchmark.js";

/** Rough constant — real deployments don't wire a live risk-free-rate feed for this estimate. */
const RISK_FREE_RATE = 0.07;
/** Used only when there isn't enough recent history to compute a real historical volatility. */
const FALLBACK_VOL_INDEX = 0.13;
const FALLBACK_VOL_STOCK = 0.3;

interface SpotFetcher {
  getSpot(symbol: string): Promise<number | null>;
}

class YahooSpot implements SpotFetcher {
  constructor(private timeoutMs = 8000) {}
  async getSpot(symbol: string): Promise<number | null> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok) return null;
      const json = (await res.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number } }[] } };
      const price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
      return price != null && Number.isFinite(price) ? price : null;
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }
}

/**
 * *Estimates* a current price for F&O contracts (options via Black-Scholes, futures via
 * cost-of-carry) from the live underlying, since no free exchange-quoted feed for Indian
 * derivatives is reachable (NSE's own API blocks non-browser traffic). Every quote this
 * emits is a model price, not a traded one — the `provider` id lets callers label it as
 * such rather than presenting it as a real market quote.
 */
export class DerivativeEstimateProvider implements MarketDataProvider {
  id = "derivative-estimate";

  constructor(
    private spot: SpotFetcher = new YahooSpot(),
    private history: BenchmarkProvider = new YahooBenchmarkProvider(),
  ) {}

  private async volatilityFor(yahooSymbol: string, isIndex: boolean): Promise<number> {
    const to = new Date();
    const from = new Date(to.getTime() - 60 * 24 * 60 * 60 * 1000); // ~60 calendar days of history
    const bars = await this.history.getHistory(yahooSymbol, from.toISOString(), to.toISOString());
    const vol = annualizedVolatility(bars.map((b) => b.close));
    return vol ?? (isIndex ? FALLBACK_VOL_INDEX : FALLBACK_VOL_STOCK);
  }

  async getQuotes(securities: SecurityLike[]): Promise<QuoteData[]> {
    const parsed = securities
      .map((s) => ({ s, p: parseDerivativeSymbol(s.symbol) }))
      .filter((x): x is { s: SecurityLike; p: NonNullable<ReturnType<typeof parseDerivativeSymbol>> } => x.p !== null);

    const now = Date.now();
    const live = parsed.filter((x) => new Date(x.p.expiryISO).getTime() >= now); // skip expired contracts — no live estimate

    const underlyings = [...new Set(live.map((x) => x.p.underlying))];
    const spotBySym = new Map<string, number | null>();
    const volBySym = new Map<string, number>();
    for (const u of underlyings) {
      const ysym = underlyingYahooSymbol(u);
      const isIndex = ysym.startsWith("^");
      const [spotPrice, vol] = await Promise.all([this.spot.getSpot(ysym), this.volatilityFor(ysym, isIndex)]);
      spotBySym.set(u, spotPrice);
      volBySym.set(u, vol);
    }

    const out: QuoteData[] = [];
    const asOf = new Date().toISOString();
    for (const { s, p } of live) {
      const spot = spotBySym.get(p.underlying);
      if (spot == null) continue; // underlying not resolvable (e.g. an MCX commodity future) — no estimate
      const yearsToExpiry = Math.max((new Date(p.expiryISO).getTime() - now) / (365 * 24 * 60 * 60 * 1000), 0);
      const sigma = volBySym.get(p.underlying)!;
      let price: number;
      if (p.kind === "future") {
        price = futuresFairValue(spot, RISK_FREE_RATE, yearsToExpiry);
      } else {
        const inputs = { spot, strike: p.strike, yearsToExpiry, riskFreeRate: RISK_FREE_RATE, volatility: sigma };
        price = p.optionType === "CE" ? bsCall(inputs) : bsPut(inputs);
      }
      if (!Number.isFinite(price) || price < 0) continue;
      out.push({ securityId: s.id, price: String(price), prevClose: null, currency: "INR", asOf, provider: this.id });
    }
    return out;
  }
}
