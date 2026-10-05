/**
 * Portfolio X-ray — a plain-language health read on the shape of a portfolio: how concentrated it
 * is, how much is sitting in cash, and how spread across asset classes. Pure and deterministic; every
 * input is a real derived value (see holdings + diversification), nothing is estimated or advice.
 *
 * It reuses the concentration read (single-stock / sector / breadth) and adds the dimensions that
 * read over the *whole* net worth — cash drag and asset-class skew — then blends a 0..100 score.
 */

export type XraySeverity = "high" | "warn" | "info" | "good";

export interface XrayFinding {
  id: string;
  severity: XraySeverity;
  title: string;
  detail: string;
}

export interface XrayInput {
  /** Base-currency totals (net worth includes cash + manual assets). */
  netWorth: number;
  cash: number;
  manualAssets: number;
  /** Asset-class weights over net worth, e.g. [{ key: "equity", weight: 0.82 }, …]. */
  byAssetClass: { key: string; weight: number }[];
  /** The concentration read (packages/core/diversification). */
  diversification: {
    available: boolean;
    positions: number;
    score: number; // 0..100, over invested positions
    top1: { label: string; weight: number } | null;
    top5Weight: number;
    topSector: { label: string; weight: number } | null;
  };
}

export interface XrayResult {
  available: boolean;
  score: number; // 0..100, higher = healthier shape
  grade: "Healthy" | "Fair" | "Needs work" | "Fragile";
  /** Headline metrics, as fractions 0..1. */
  cashWeight: number;
  topClass: { key: string; weight: number } | null;
  findings: XrayFinding[]; // most severe first
}

const pct = (w: number) => `${(w * 100).toFixed(1)}%`;
const RANK: Record<XraySeverity, number> = { high: 0, warn: 1, info: 2, good: 3 };

/** Label an asset-class key the way the UI does (kept minimal; the web maps the rest). */
const CLASS_LABEL: Record<string, string> = { equity: "equities", mf: "mutual funds", etf: "ETFs", debt: "debt", bond: "bonds", gold: "gold", crypto: "crypto", cash: "cash", reit_invit: "REITs/InvITs" };
const className = (k: string) => CLASS_LABEL[k] ?? k;

export function portfolioXray(input: XrayInput): XrayResult {
  const { netWorth, cash, diversification: div } = input;
  if (!(netWorth > 0)) {
    return { available: false, score: 0, grade: "Fragile", cashWeight: 0, topClass: null, findings: [] };
  }

  const cashWeight = Math.max(0, Math.min(1, cash / netWorth));
  const nonCashClasses = input.byAssetClass.filter((c) => c.key !== "cash");
  const topClass = [...nonCashClasses].sort((a, b) => b.weight - a.weight)[0] ?? null;

  const findings: XrayFinding[] = [];

  // Single-stock concentration (over invested positions).
  if (div.top1) {
    if (div.top1.weight >= 0.4) findings.push({ id: "concentration", severity: "high", title: "Heavy single-stock bet", detail: `${div.top1.label} is ${pct(div.top1.weight)} of your invested value — a big concentration in one name.` });
    else if (div.top1.weight >= 0.25) findings.push({ id: "concentration", severity: "warn", title: "Concentrated in one stock", detail: `${div.top1.label} is ${pct(div.top1.weight)} of your invested value.` });
  }

  // Sector concentration.
  if (div.topSector && div.topSector.label !== "Unclassified") {
    if (div.topSector.weight >= 0.55) findings.push({ id: "sector", severity: "high", title: "Heavy sector concentration", detail: `${div.topSector.label} is ${pct(div.topSector.weight)} of your invested value.` });
    else if (div.topSector.weight >= 0.4) findings.push({ id: "sector", severity: "warn", title: "Leaning on one sector", detail: `${div.topSector.label} is ${pct(div.topSector.weight)} of your invested value.` });
  }

  // Breadth: five-largest share, and too-few holdings.
  if (div.positions >= 5 && div.top5Weight >= 0.8) findings.push({ id: "top5", severity: "warn", title: "Top five dominate", detail: `Your five largest holdings are ${pct(div.top5Weight)} of your invested value.` });
  if (div.available && div.positions > 0 && div.positions < 5) findings.push({ id: "breadth", severity: "info", title: "Few holdings", detail: `Only ${div.positions} holding${div.positions === 1 ? "" : "s"} — limited spread.` });

  // Cash drag — over the whole net worth.
  if (cashWeight >= 0.3) findings.push({ id: "cash-drag", severity: "high", title: "Lots of idle cash", detail: `${pct(cashWeight)} of your net worth is cash — a large drag if it isn't earmarked.` });
  else if (cashWeight >= 0.15) findings.push({ id: "cash-drag", severity: "warn", title: "Cash building up", detail: `${pct(cashWeight)} of your net worth is sitting in cash.` });

  // Asset-class skew — informational (equity-heavy is common, not wrong).
  if (topClass && topClass.weight >= 0.95 && div.positions > 1) findings.push({ id: "class-skew", severity: "info", title: "Almost one asset class", detail: `${pct(topClass.weight)} is in ${className(topClass.key)} — little spread across asset classes.` });

  // Score: start from the concentration score, dock cash drag over 15% (up to 25 points).
  const cashPenalty = cashWeight > 0.15 ? Math.min(25, Math.round((cashWeight - 0.15) * 100)) : 0;
  const base = div.available ? div.score : 50;
  const score = Math.max(0, Math.min(100, base - cashPenalty));
  const grade = score >= 75 ? "Healthy" : score >= 55 ? "Fair" : score >= 35 ? "Needs work" : "Fragile";

  if (findings.filter((f) => f.severity === "high" || f.severity === "warn").length === 0) {
    findings.push({ id: "ok", severity: "good", title: "Well balanced", detail: `Spread across ${div.positions} holding${div.positions === 1 ? "" : "s"} with cash at ${pct(cashWeight)}.` });
  }

  findings.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  return { available: true, score, grade, cashWeight, topClass, findings };
}
