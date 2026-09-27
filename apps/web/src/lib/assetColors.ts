/** One fixed, solid colour per asset class, so a class looks the same on every screen. */
const CLASS_COLORS: Record<string, string> = {
  equity: "#f0b23e",
  mf: "#8c8fe0",
  etf: "#5fb7a6",
  bond: "#7fa66b",
  sgb: "#d97757",
  gold: "#d97757",
  reit_invit: "#c9a27e",
  crypto: "#d77fb3",
  cash: "#d9d2c3",
  other: "#6f6f7a",
};

const FALLBACK = ["#b8a9e8", "#7cc7d9", "#e3c07a", "#9dbf8c", "#e08f7a", "#a3a3ad"];

export function assetColor(key: string, index = 0): string {
  return CLASS_COLORS[key] ?? FALLBACK[index % FALLBACK.length] ?? "#6f6f7a";
}
