import { Decimal, d } from "./money.js";

/**
 * Fixed deposits and bonds: what a deposit is worth on a day from its amount, rate and dates.
 *
 * Interest is added `periods` times a year (quarterly is how Indian banks compound FDs) or
 * accrues simply, or is paid out (coupon bonds, "payout" FDs) so the holding itself stays at
 * the principal. Time is counted in days over a 365-day year. Before the start the deposit is
 * worth its principal; after maturity it stops growing (the bank pays it out). Pure.
 */

export const COMPOUNDING = ["quarterly", "monthly", "half_yearly", "yearly", "simple", "payout"] as const;
export type Compounding = (typeof COMPOUNDING)[number];

const PERIODS: Record<Compounding, number> = { monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1, simple: 0, payout: 0 };
const DAY = 86_400_000;

export interface DepositTerms {
  principal: string;
  /** Percent a year, e.g. "7.1". */
  ratePct: string;
  start: string; // YYYY-MM-DD
  maturity: string | null; // YYYY-MM-DD; open-ended when null
  compounding: Compounding;
}

export interface DepositValue {
  /** Worth on `asOf`. */
  value: Decimal;
  /** Worth on the maturity day (null when there is none). */
  maturityValue: Decimal | null;
  /** Interest earned so far (already paid out, for a payout deposit). */
  interestSoFar: Decimal;
  /** Whole days until maturity (negative once past). */
  daysToMaturity: number | null;
  matured: boolean;
  /** Share of the term gone by, 0–1. */
  elapsed: number | null;
}

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

function grow(t: DepositTerms, dayCount: number): Decimal {
  const p = d(t.principal);
  if (dayCount <= 0) return p;
  const r = d(t.ratePct).div(100);
  const years = d(dayCount).div(365);
  const n = PERIODS[t.compounding];
  if (t.compounding === "payout") return p;
  if (n === 0) return p.times(d(1).plus(r.times(years)));
  return p.times(d(1).plus(r.div(n)).pow(years.times(n)));
}

function interest(t: DepositTerms, dayCount: number): Decimal {
  if (dayCount <= 0) return d(0);
  if (t.compounding === "payout") return d(t.principal).times(d(t.ratePct).div(100)).times(d(dayCount).div(365));
  return grow(t, dayCount).minus(t.principal);
}

export function depositValue(t: DepositTerms, asOf: string): DepositValue {
  const term = t.maturity ? days(t.start, t.maturity) : null;
  const gone = Math.max(0, days(t.start, asOf));
  const counted = term !== null ? Math.min(gone, Math.max(term, 0)) : gone;
  return {
    value: grow(t, counted),
    maturityValue: term !== null ? grow(t, Math.max(term, 0)) : null,
    interestSoFar: interest(t, counted),
    daysToMaturity: t.maturity ? days(asOf, t.maturity) : null,
    matured: t.maturity ? asOf >= t.maturity : false,
    elapsed: term && term > 0 ? Math.min(1, gone / term) : null,
  };
}

