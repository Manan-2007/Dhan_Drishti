/**
 * European option pricing (Black-Scholes-Merton) and cost-of-carry futures fair value, used to
 * *estimate* a current price for Indian F&O contracts when no exchange-quoted feed is reachable
 * (NSE's own option-chain API blocks non-browser traffic). These are model prices derived from
 * the live underlying, never an actual traded/exchange price — callers must label them as such.
 */

/** Standard normal CDF via the Abramowitz & Stegun 7.1.26 approximation (~1e-7 max error). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return sign * y;
}

export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export interface BsInputs {
  spot: number; // S — current underlying price
  strike: number; // K
  yearsToExpiry: number; // T, > 0
  riskFreeRate: number; // r, annualized (e.g. 0.07)
  volatility: number; // sigma, annualized (e.g. 0.18)
  dividendYield?: number; // q, annualized continuous yield (default 0)
}

/** Black-Scholes-Merton price of a European call. */
export function bsCall(i: BsInputs): number {
  const { spot: S, strike: K, yearsToExpiry: T, riskFreeRate: r, volatility: sigma, dividendYield: q = 0 } = i;
  if (T <= 0 || sigma <= 0) return Math.max(S - K, 0);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return S * Math.exp(-q * T) * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
}

/** Black-Scholes-Merton price of a European put (via the same d1/d2). */
export function bsPut(i: BsInputs): number {
  const { spot: S, strike: K, yearsToExpiry: T, riskFreeRate: r, volatility: sigma, dividendYield: q = 0 } = i;
  if (T <= 0 || sigma <= 0) return Math.max(K - S, 0);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return K * Math.exp(-r * T) * normCdf(-d2) - S * Math.exp(-q * T) * normCdf(-d1);
}

/** Cost-of-carry theoretical futures price: F = S * e^((r - q) * T). */
export function futuresFairValue(spot: number, riskFreeRate: number, yearsToExpiry: number, dividendYield = 0): number {
  if (yearsToExpiry <= 0) return spot;
  return spot * Math.exp((riskFreeRate - dividendYield) * yearsToExpiry);
}

/**
 * Annualized historical volatility from a series of daily closes (stdev of log returns * sqrt(252)).
 * Returns null when there isn't enough data (needs at least 10 return observations).
 */
export function annualizedVolatility(closes: number[]): number | null {
  if (closes.length < 11) return null;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    const cur = closes[i]!;
    if (prev > 0 && cur > 0) returns.push(Math.log(cur / prev));
  }
  if (returns.length < 10) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}
