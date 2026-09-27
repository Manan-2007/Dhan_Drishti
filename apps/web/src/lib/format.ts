/** Indian-locale money & number formatting. Inputs are decimal strings from the API. */

export function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const inr = (currency: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 });

export function money(value: string | number | null | undefined, currency = "INR"): string {
  const n = num(value);
  if (n === null) return "—";
  return inr(currency).format(n);
}

/** Compact Indian units (Lakh/Crore) for large dashboard figures. */
export function compactMoney(value: string | number | null | undefined, currency = "INR"): string {
  const n = num(value);
  if (n === null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const sym = currency === "INR" ? "₹" : "";
  if (abs >= 1e7) return `${sign}${sym}${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}${sym}${(abs / 1e5).toFixed(2)} L`;
  return money(value, currency);
}

/** Money with an explicit sign and a true minus (−), compact in L/Cr: "+₹41.2 K" style for changes. */
export function signedMoney(value: string | number | null | undefined, currency = "INR", compact = true): string {
  const n = num(value);
  if (n === null) return "—";
  const body = compact ? compactMoney(Math.abs(n), currency) : money(Math.abs(n), currency);
  if (n === 0) return body;
  return `${n > 0 ? "+" : "−"}${body}`;
}

/** A fraction as a signed percentage with a true minus: 0.0123 → "+1.23%". */
export function signedPct(value: string | number | null | undefined, digits = 2): string {
  const n = num(value);
  if (n === null) return "—";
  const body = `${Math.abs(n * 100).toFixed(digits)}%`;
  if (n === 0) return body;
  return `${n > 0 ? "+" : "−"}${body}`;
}

/** "3 min ago", "5 h ago", "2 d ago" — for as-of stamps. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function qty(value: string | number | null | undefined): string {
  const n = num(value);
  if (n === null) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format(n);
}

/** value is a fraction (0.5 → "50.00%"). */
export function pct(value: string | number | null | undefined): string {
  const n = num(value);
  if (n === null) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

export function signClass(value: string | number | null | undefined): string {
  const n = num(value);
  if (n === null || n === 0) return "text-muted-foreground";
  return n > 0 ? "text-success" : "text-destructive";
}

export function signGlyph(value: string | number | null | undefined): string {
  const n = num(value);
  if (n === null || n === 0) return "";
  return n > 0 ? "▲ " : "▼ ";
}

export function dateShort(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "2-digit" });
}

/** Indian financial year label for a date (Apr–Mar), e.g. "FY 24-25" — mirrors the server. */
export function financialYear(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const y = dt.getUTCFullYear();
  const start = dt.getUTCMonth() >= 3 ? y : y - 1;
  const two = (n: number) => String(n % 100).padStart(2, "0");
  return `FY ${two(start)}-${two(start + 1)}`;
}

const ASSET_CLASS_LABELS: Record<string, string> = {
  equity: "Equity",
  etf: "ETF",
  mf: "Mutual Fund",
  bond: "Bonds",
  reit_invit: "REIT / InvIT",
  sgb: "SGB",
  crypto: "Crypto",
  cash: "Cash",
  // Manual / non-market asset classes
  fd: "Fixed Deposit",
  ppf: "PPF",
  epf: "EPF",
  nps: "NPS",
  savings: "Savings",
  gold: "Gold",
  real_estate: "Real Estate",
  other: "Other",
};
export const assetClassLabel = (k: string): string => ASSET_CLASS_LABELS[k] ?? k;
