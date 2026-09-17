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

const ASSET_CLASS_LABELS: Record<string, string> = {
  equity: "Equity",
  etf: "ETF",
  mf: "Mutual Fund",
  bond: "Bonds",
  reit_invit: "REIT / InvIT",
  sgb: "SGB",
  crypto: "Crypto",
  cash: "Cash",
  other: "Other",
};
export const assetClassLabel = (k: string): string => ASSET_CLASS_LABELS[k] ?? k;
