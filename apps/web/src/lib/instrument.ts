/**
 * Readable names for F&O contracts. Brokers print them as codes — Zerodha "NIFTY26MAY21500PE",
 * Dhan "OPT NIFTY 26 MAY 2026 21500 PE" — which say the same thing: NIFTY, strike 21500, put,
 * expiring in May 2026. Mirrors the server's parser (market/derivative-symbol.ts).
 */

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const WEEKLY: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6, "8": 7, "9": 8, O: 9, N: 10, D: 11 };
const monthName = (m0: number) => new Date(Date.UTC(2000, m0, 1)).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
const strikeText = (s: string) => Number(s).toLocaleString("en-IN");

export interface Instrument {
  /** "NIFTY 21500 PE", "RELIANCE FUT" */
  title: string;
  /** "May 2026 expiry", "5 Jun 2025 expiry" */
  expiry: string;
}

export function readableContract(symbol: string): Instrument | null {
  const s = symbol.toUpperCase().trim();
  let m = /^([A-Z0-9&-]+?)(\d{2})([A-Z]{3})(\d+(?:\.\d+)?)(CE|PE)$/.exec(s);
  if (m && MONTHS.includes(m[3]!)) return { title: `${m[1]} ${strikeText(m[4]!)} ${m[5]}`, expiry: `${monthName(MONTHS.indexOf(m[3]!))} 20${m[2]} expiry` };
  m = /^([A-Z0-9&-]+?)(\d{2})([1-9OND])(\d{2})(\d+(?:\.\d+)?)(CE|PE)$/.exec(s);
  if (m) return { title: `${m[1]} ${strikeText(m[5]!)} ${m[6]}`, expiry: `${Number(m[4])} ${monthName(WEEKLY[m[3]!]!)} 20${m[2]} expiry` };
  m = /^([A-Z0-9&-]+?)(\d{2})([A-Z]{3})FUT$/.exec(s);
  if (m && MONTHS.includes(m[3]!)) return { title: `${m[1]} FUT`, expiry: `${monthName(MONTHS.indexOf(m[3]!))} 20${m[2]} expiry` };
  m = /^OPT\s+([A-Z0-9&-]+)\s+(\d{1,2})\s+([A-Z]{3})\s+(\d{4})\s+(\d+(?:\.\d+)?)\s+(CE|PE)$/.exec(s);
  if (m && MONTHS.includes(m[3]!)) return { title: `${m[1]} ${strikeText(m[5]!)} ${m[6]}`, expiry: `${Number(m[2])} ${monthName(MONTHS.indexOf(m[3]!))} ${m[4]} expiry` };
  m = /^FUT\s+([A-Z0-9&-]+)\s+(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/.exec(s);
  if (m && MONTHS.includes(m[3]!)) return { title: `${m[1]} FUT`, expiry: `${Number(m[2])} ${monthName(MONTHS.indexOf(m[3]!))} ${m[4]} expiry` };
  return null;
}

/** What to call a security on screen: the readable contract, else its symbol. */
export function displayName(security: { symbol: string }): string {
  return readableContract(security.symbol)?.title ?? security.symbol;
}
