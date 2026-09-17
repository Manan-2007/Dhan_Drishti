import { Decimal } from "decimal.js";

// Configure once: 28 significant digits is ample for portfolio math; round half-up.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

/** A monetary or quantity value carried as an exact decimal. Never a float. */
export type DecimalInput = string | number | Decimal;

export function d(value: DecimalInput): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

export const ZERO = new Decimal(0);

/** Safe division: returns null instead of NaN/Infinity when the divisor is zero. */
export function safeDiv(numerator: DecimalInput, denominator: DecimalInput): Decimal | null {
  const den = d(denominator);
  if (den.isZero()) return null;
  return d(numerator).div(den);
}

/** Serialize a Decimal to a stable string for storage (fixed, no exponent). */
export function toStore(value: Decimal | null): string | null {
  return value === null ? null : value.toFixed();
}

/** Round to a currency's minor units for display (default 2). Storage stays full precision. */
export function roundMoney(value: Decimal, dp = 2): Decimal {
  return value.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
}

export { Decimal };
