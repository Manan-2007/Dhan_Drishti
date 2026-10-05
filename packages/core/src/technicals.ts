import { Decimal, d } from "./money.js";

/**
 * Technical indicators over a daily close series — pure, deterministic, no I/O. Everything here is
 * derived from real price history (never fabricated): moving averages, RSI, recent price ranges,
 * where the latest price sits in its 52-week band, window returns, and pivot support/resistance.
 *
 * Prices stay exact (decimal.js); price-valued outputs come back as decimal strings rounded to 4
 * places, and bounded ratios (RSI, percent changes, 0..1 position) come back as plain numbers since
 * they are analytics for display, not money.
 */

export interface PriceBar {
  date: string; // YYYY-MM-DD, oldest → newest
  close: string | number;
}

export interface PriceRange {
  low: string;
  high: string;
}

export interface TechnicalsResult {
  /** Latest close and its date. */
  last: string | null;
  asOf: string | null;
  /** Simple moving averages, by period (null until there are enough bars). */
  sma: Record<number, string | null>;
  /** Exponential moving averages, by period. */
  ema: Record<number, string | null>;
  /** 14-day Wilder RSI, 0..100 (null until there are enough bars). */
  rsi14: number | null;
  /** Latest vs the longest available SMA. */
  trend: "above" | "below" | null;
  /** High/low close over roughly the last week / month / quarter / year of trading days. */
  ranges: { week: PriceRange | null; month: PriceRange | null; quarter: PriceRange | null; year: PriceRange | null };
  /** Where the latest close sits inside the 52-week band, 0 (low) .. 1 (high). */
  rangePosition52w: number | null;
  /** Percent change over roughly the last week / month / quarter / year. */
  changePct: { week: number | null; month: number | null; quarter: number | null; year: number | null };
  /** Classic pivot support (S1) / resistance (R1) over a recent lookback window. */
  support: string | null;
  resistance: string | null;
  /** How many bars went into this. */
  bars: number;
}

/** ~Trading days in each window. */
const WINDOW = { week: 5, month: 21, quarter: 63, year: 252 } as const;
const DEFAULT_SMA = [20, 50, 200];
const DEFAULT_EMA = [12, 26];

const toDecimals = (closes: (string | number)[]): Decimal[] => closes.map((c) => d(c));
const str = (x: Decimal): string => x.toDecimalPlaces(4).toString();

/** Simple moving average, aligned to the input (null until `period` values are available). */
export function sma(closes: (string | number)[], period: number): (string | null)[] {
  const v = toDecimals(closes);
  const out: (string | null)[] = new Array(v.length).fill(null);
  if (period <= 0) return out;
  let sum = new Decimal(0);
  for (let i = 0; i < v.length; i++) {
    sum = sum.plus(v[i]!);
    if (i >= period) sum = sum.minus(v[i - period]!);
    if (i >= period - 1) out[i] = str(sum.div(period));
  }
  return out;
}

/** Exponential moving average (seeded with the SMA of the first `period` values). */
export function ema(closes: (string | number)[], period: number): (string | null)[] {
  const v = toDecimals(closes);
  const out: (string | null)[] = new Array(v.length).fill(null);
  if (period <= 0 || v.length < period) return out;
  const k = new Decimal(2).div(period + 1);
  let seed = new Decimal(0);
  for (let i = 0; i < period; i++) seed = seed.plus(v[i]!);
  let prev = seed.div(period);
  out[period - 1] = str(prev);
  for (let i = period; i < v.length; i++) {
    prev = v[i]!.minus(prev).times(k).plus(prev);
    out[i] = str(prev);
  }
  return out;
}

/** Wilder's RSI, 0..100 (null until `period + 1` values are available). */
export function rsi(closes: (string | number)[], period = 14): (number | null)[] {
  const v = toDecimals(closes);
  const out: (number | null)[] = new Array(v.length).fill(null);
  if (v.length <= period) return out;
  let gain = new Decimal(0);
  let loss = new Decimal(0);
  for (let i = 1; i <= period; i++) {
    const ch = v[i]!.minus(v[i - 1]!);
    if (ch.gte(0)) gain = gain.plus(ch);
    else loss = loss.plus(ch.abs());
  }
  let avgGain = gain.div(period);
  let avgLoss = loss.div(period);
  const rsiFrom = (g: Decimal, l: Decimal) => (l.isZero() ? 100 : 100 - 100 / (1 + g.div(l).toNumber()));
  out[period] = rsiFrom(avgGain, avgLoss);
  for (let i = period + 1; i < v.length; i++) {
    const ch = v[i]!.minus(v[i - 1]!);
    const g = ch.gte(0) ? ch : new Decimal(0);
    const l = ch.lt(0) ? ch.abs() : new Decimal(0);
    avgGain = avgGain.times(period - 1).plus(g).div(period);
    avgLoss = avgLoss.times(period - 1).plus(l).div(period);
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

function rangeOf(v: Decimal[], window: number): PriceRange | null {
  if (v.length === 0) return null;
  const slice = v.slice(Math.max(0, v.length - window));
  let lo = slice[0]!;
  let hi = slice[0]!;
  for (const x of slice) {
    if (x.lt(lo)) lo = x;
    if (x.gt(hi)) hi = x;
  }
  return { low: str(lo), high: str(hi) };
}

function changeOver(v: Decimal[], window: number): number | null {
  if (v.length < 2) return null;
  const last = v[v.length - 1]!;
  const ago = v[Math.max(0, v.length - 1 - window)]!;
  if (ago.isZero()) return null;
  return last.minus(ago).div(ago).times(100).toNumber();
}

/** Classic pivot support/resistance over the last `window` bars (high/low/close of that window). */
function pivots(v: Decimal[], window: number): { support: string | null; resistance: string | null } {
  if (v.length === 0) return { support: null, resistance: null };
  const r = rangeOf(v, window)!;
  const high = d(r.high);
  const low = d(r.low);
  const close = v[v.length - 1]!;
  const pivot = high.plus(low).plus(close).div(3);
  const r1 = pivot.times(2).minus(low);
  const s1 = Decimal.max(0, pivot.times(2).minus(high));
  return { support: str(s1), resistance: str(r1) };
}

/**
 * Full technical read for one series. `bars` must be oldest → newest. Everything degrades
 * gracefully: too few bars just means more nulls, never a throw.
 */
export function computeTechnicals(
  bars: PriceBar[],
  opts: { smaPeriods?: number[]; emaPeriods?: number[]; pivotWindow?: number } = {},
): TechnicalsResult {
  const smaPeriods = opts.smaPeriods ?? DEFAULT_SMA;
  const emaPeriods = opts.emaPeriods ?? DEFAULT_EMA;
  const closes = bars.map((b) => b.close);
  const v = toDecimals(closes);
  const n = v.length;

  const smaOut: Record<number, string | null> = {};
  for (const p of smaPeriods) smaOut[p] = sma(closes, p)[n - 1] ?? null;
  const emaOut: Record<number, string | null> = {};
  for (const p of emaPeriods) emaOut[p] = ema(closes, p)[n - 1] ?? null;
  const rsiOut = n ? rsi(closes, 14)[n - 1] ?? null : null;

  const last = n ? v[n - 1]! : null;
  const year = rangeOf(v, WINDOW.year);
  let position: number | null = null;
  if (last && year) {
    const lo = d(year.low);
    const hi = d(year.high);
    position = hi.gt(lo) ? Decimal.min(1, Decimal.max(0, last.minus(lo).div(hi.minus(lo)))).toNumber() : null;
  }

  // Trend vs the longest SMA that actually resolved.
  let trend: "above" | "below" | null = null;
  for (const p of [...smaPeriods].sort((a, b) => b - a)) {
    const m = smaOut[p];
    if (m != null && last) {
      trend = last.gte(d(m)) ? "above" : "below";
      break;
    }
  }

  const pv = pivots(v, Math.min(n, 60));

  return {
    last: last ? str(last) : null,
    asOf: n ? bars[n - 1]!.date : null,
    sma: smaOut,
    ema: emaOut,
    rsi14: rsiOut,
    trend,
    ranges: {
      week: rangeOf(v, WINDOW.week),
      month: rangeOf(v, WINDOW.month),
      quarter: rangeOf(v, WINDOW.quarter),
      year,
    },
    rangePosition52w: position,
    changePct: {
      week: changeOver(v, WINDOW.week),
      month: changeOver(v, WINDOW.month),
      quarter: changeOver(v, WINDOW.quarter),
      year: changeOver(v, WINDOW.year),
    },
    support: pv.support,
    resistance: pv.resistance,
    bars: n,
  };
}
