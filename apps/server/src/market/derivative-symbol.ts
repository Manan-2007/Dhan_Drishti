/**
 * Parses an F&O contract's broker symbol into its underlying, expiry and (for options) strike —
 * needed to estimate a current price from the live underlying. Two broker conventions are seen
 * in imported data:
 *   - Zerodha: the raw NSE trading symbol, e.g. "NIFTY25JUN26000CE", "RELIANCE25JUNFUT".
 *     It carries no expiry day — only month/year — so we resolve it to the LAST CALENDAR DAY of
 *     that month. NSE's actual monthly expiry (last Tue/Thu) falls a few days earlier, which is
 *     fine for an already-approximate estimate but is never off by more than a few days.
 *   - Dhan: a descriptive string with an exact day, e.g. "OPT NIFTY 30 JUN 2026 24000 PE",
 *     "FUT ICICIBANK 28 AUG 2025".
 */

/**
 * `expiryApprox` is set when the symbol names only a month (Zerodha monthlies): `expiryISO` is then
 * the month's last day, and the real expiry is that month's last expiry weekday — see
 * `monthlyExpiryDay`.
 */
export type ParsedDerivative =
  | { kind: "option"; underlying: string; expiryISO: string; strike: number; optionType: "CE" | "PE"; expiryApprox?: true }
  | { kind: "future"; underlying: string; expiryISO: string; expiryApprox?: true };

const MONTHS: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

function lastDayOfMonth(year: number, month0: number): string {
  return new Date(Date.UTC(year, month0 + 1, 0)).toISOString().slice(0, 10);
}

function exactDay(day: number, month0: number, year: number): string {
  return new Date(Date.UTC(year, month0, day)).toISOString().slice(0, 10);
}

/** Weekly expiry month codes in NSE symbols: 1–9 for Jan–Sep, then O, N, D. */
const WEEKLY_MONTH: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6, "8": 7, "9": 8, O: 9, N: 10, D: 11 };

/**
 * Zerodha's raw NSE trading symbol. Monthly: SYMBOL + YY + MMM + (STRIKE + CE|PE, or FUT).
 * Weekly options carry the exact day: SYMBOL + YY + M + DD + STRIKE + CE|PE ("NIFTY2560524000CE").
 * Underlyings can hold digits, "&" and "-" (360ONE, M&M, BAJAJ-AUTO); strikes can be decimal.
 */
function parseZerodha(symbol: string): ParsedDerivative | null {
  const opt = /^([A-Z0-9&-]+?)(\d{2})([A-Z]{3})(\d+(?:\.\d+)?)(CE|PE)$/.exec(symbol);
  if (opt) {
    const [, underlying, yy, mmm, strike, type] = opt;
    const month0 = MONTHS[mmm!];
    if (month0 === undefined) return null;
    const year = 2000 + Number(yy);
    return { kind: "option", underlying: underlying!, expiryISO: lastDayOfMonth(year, month0), strike: Number(strike), optionType: type as "CE" | "PE", expiryApprox: true };
  }
  const weekly = /^([A-Z0-9&-]+?)(\d{2})([1-9OND])(\d{2})(\d+(?:\.\d+)?)(CE|PE)$/.exec(symbol);
  if (weekly) {
    const [, underlying, yy, m, dd, strike, type] = weekly;
    const month0 = WEEKLY_MONTH[m!]!;
    const day = Number(dd);
    if (day < 1 || day > 31) return null;
    return { kind: "option", underlying: underlying!, expiryISO: exactDay(day, month0, 2000 + Number(yy)), strike: Number(strike), optionType: type as "CE" | "PE" };
  }
  const fut = /^([A-Z0-9&-]+?)(\d{2})([A-Z]{3})FUT$/.exec(symbol);
  if (fut) {
    const [, underlying, yy, mmm] = fut;
    const month0 = MONTHS[mmm!];
    if (month0 === undefined) return null;
    const year = 2000 + Number(yy);
    return { kind: "future", underlying: underlying!, expiryISO: lastDayOfMonth(year, month0), expiryApprox: true };
  }
  return null;
}

/**
 * The day a monthly NSE contract expires: the month's last Thursday, or its last Tuesday from
 * September 2025, when NSE moved its equity-derivative expiries to Tuesday. (A holiday moves it to
 * the trading day before — settle.ts reads that off the underlying's own price history.)
 */
export function monthlyExpiryDay(lastDayISO: string): string {
  const last = new Date(`${lastDayISO}T00:00:00Z`);
  const weekday = lastDayISO >= "2025-09-01" ? 2 : 4; // Tue : Thu
  const back = (last.getUTCDay() - weekday + 7) % 7;
  last.setUTCDate(last.getUTCDate() - back);
  return last.toISOString().slice(0, 10);
}

/** Dhan's descriptive form: "OPT <UNDERLYING> <DD> <MMM> <YYYY> <STRIKE> <CE|PE>" / "FUT <UNDERLYING> <DD> <MMM> <YYYY>". */
function parseDhan(text: string): ParsedDerivative | null {
  const opt = /^OPT\s+([A-Z0-9&-]+)\s+(\d{1,2})\s+([A-Z]{3})\s+(\d{4})\s+(\d+(?:\.\d+)?)\s+(CE|PE)$/.exec(text);
  if (opt) {
    const [, underlying, dd, mmm, yyyy, strike, type] = opt;
    const month0 = MONTHS[mmm!];
    if (month0 === undefined) return null;
    return {
      kind: "option",
      underlying: underlying!,
      expiryISO: exactDay(Number(dd), month0, Number(yyyy)),
      strike: Number(strike),
      optionType: type as "CE" | "PE",
    };
  }
  const fut = /^FUT\s+([A-Z0-9&-]+)\s+(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/.exec(text);
  if (fut) {
    const [, underlying, dd, mmm, yyyy] = fut;
    const month0 = MONTHS[mmm!];
    if (month0 === undefined) return null;
    return { kind: "future", underlying: underlying!, expiryISO: exactDay(Number(dd), month0, Number(yyyy)) };
  }
  return null;
}

/** Try both broker conventions against a security's symbol (falling back to its name). */
export function parseDerivativeSymbol(symbol: string, name?: string): ParsedDerivative | null {
  const s = (symbol ?? "").toUpperCase().trim();
  const n = (name ?? "").toUpperCase().trim();
  return parseZerodha(s) ?? parseDhan(s) ?? (n && n !== s ? parseDhan(n) : null);
}

/** Map a parsed contract's underlying to a Yahoo Finance symbol (index alias, else NSE stock). */
export function underlyingYahooSymbol(underlying: string): string {
  if (underlying === "NIFTY") return "^NSEI";
  if (underlying === "BANKNIFTY") return "^NSEBANK";
  if (underlying === "FINNIFTY") return "^CNXFIN";
  return `${underlying}.NS`; // single-stock F&O underlyings are themselves NSE-listed stocks
}
