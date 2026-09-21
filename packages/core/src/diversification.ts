import { Decimal, d, ZERO } from "./money.js";

/**
 * Diversification & concentration health — a purely derived read on how spread-out (or
 * lopsided) a portfolio is. Every input is a real priced position value; nothing is
 * estimated. Weights are fractions (0..1); the score is a 0..100 health summary and the
 * flags are the actionable part. Pure & deterministic. See docs/CALCULATIONS.md.
 */

/** One priced position fed into the concentration read. `value` is a base-currency decimal string (>0). */
export interface DivPosition {
  label: string; // display label (symbol/name)
  sector: string; // sector bucket (already resolved; "Unclassified" if unknown)
  value: string;
}

export type FlagSeverity = "info" | "warn" | "high";
export interface ConcentrationFlag {
  severity: FlagSeverity;
  message: string;
}

export interface DiversificationResult {
  available: boolean;
  positions: number; // priced positions counted
  /** Herfindahl–Hirschman index over position weights (Σ wᵢ²), 0..1 — higher = more concentrated. */
  hhi: number;
  /** Effective number of equally-weighted holdings (1/HHI) — an intuitive "breadth". */
  effectiveHoldings: number;
  sectors: number; // distinct sectors present
  hhiSector: number; // HHI over sector weights
  score: number; // 0..100 health (higher = better diversified)
  grade: "Excellent" | "Good" | "Fair" | "Concentrated";
  top1: { label: string; weight: number; value: string } | null; // largest single position
  top5Weight: number; // combined weight of the five largest positions
  topSector: { label: string; weight: number; value: string } | null; // largest sector
  flags: ConcentrationFlag[];
}

function hhiOf(weights: number[]): number {
  return weights.reduce((acc, w) => acc + w * w, 0);
}

const pctText = (w: number): string => `${(w * 100).toFixed(1)}%`;

/**
 * Compute the concentration read from priced positions. Weights are taken over the sum of
 * position values (cash is excluded — this measures how the *invested* money is spread).
 */
export function computeDiversification(positions: DivPosition[]): DiversificationResult {
  const priced = positions.filter((p) => {
    const v = Number(p.value);
    return Number.isFinite(v) && v > 0;
  });
  const empty: DiversificationResult = {
    available: false,
    positions: 0,
    hhi: 0,
    effectiveHoldings: 0,
    sectors: 0,
    hhiSector: 0,
    score: 0,
    grade: "Concentrated",
    top1: null,
    top5Weight: 0,
    topSector: null,
    flags: [],
  };
  if (priced.length === 0) return empty;

  const total = priced.reduce((acc, p) => acc.plus(d(p.value)), ZERO);
  if (total.lessThanOrEqualTo(0)) return empty;

  // Position weights (sorted desc), and sector weights, both over the same invested total.
  const byValue = [...priced].sort((a, b) => Number(b.value) - Number(a.value));
  const weight = (v: string): number => d(v).div(total).toNumber();
  const posWeights = byValue.map((p) => weight(p.value));

  const sectorTotals = new Map<string, Decimal>();
  for (const p of priced) sectorTotals.set(p.sector, (sectorTotals.get(p.sector) ?? ZERO).plus(d(p.value)));
  const sectorsSorted = [...sectorTotals.entries()]
    .map(([label, v]) => ({ label, value: v, weight: v.div(total).toNumber() }))
    .sort((a, b) => b.weight - a.weight);
  const sectorWeights = sectorsSorted.map((s) => s.weight);

  const hhi = hhiOf(posWeights);
  const hhiSector = hhiOf(sectorWeights);
  const effectiveHoldings = hhi > 0 ? 1 / hhi : 0;
  const top1 = byValue[0] ? { label: byValue[0].label, weight: posWeights[0]!, value: byValue[0].value } : null;
  const top5Weight = posWeights.slice(0, 5).reduce((a, w) => a + w, 0);
  const topSector = sectorsSorted[0]
    ? { label: sectorsSorted[0].label, weight: sectorsSorted[0].weight, value: sectorsSorted[0].value.toFixed() }
    : null;

  // Health score: reward breadth across both holdings and sectors (1 − HHI on each), blended.
  // A lone holding → 0; many well-spread holdings across sectors → ~90+. Rounded to 0..100.
  const raw = 0.6 * (1 - hhi) + 0.4 * (1 - hhiSector);
  const score = Math.max(0, Math.min(100, Math.round(raw * 100)));
  const grade = score >= 80 ? "Excellent" : score >= 60 ? "Good" : score >= 40 ? "Fair" : "Concentrated";

  // Flags — conventional rules of thumb, worded plainly. Order: most severe first.
  const flags: ConcentrationFlag[] = [];
  if (top1) {
    if (top1.weight >= 0.25)
      flags.push({ severity: "high", message: `${top1.label} is ${pctText(top1.weight)} of the portfolio — a large single-position bet.` });
    else if (top1.weight >= 0.15)
      flags.push({ severity: "warn", message: `${top1.label} is ${pctText(top1.weight)} of the portfolio.` });
  }
  if (topSector && topSector.label !== "Unclassified") {
    if (topSector.weight >= 0.55)
      flags.push({ severity: "high", message: `${topSector.label} makes up ${pctText(topSector.weight)} of the portfolio — heavy sector concentration.` });
    else if (topSector.weight >= 0.4)
      flags.push({ severity: "warn", message: `${topSector.label} makes up ${pctText(topSector.weight)} — watch sector concentration.` });
  }
  if (priced.length >= 5 && top5Weight >= 0.7)
    flags.push({ severity: "warn", message: `Your five largest holdings are ${pctText(top5Weight)} of the portfolio.` });
  if (priced.length < 5)
    flags.push({ severity: "info", message: `Only ${priced.length} holding${priced.length === 1 ? "" : "s"} — limited diversification.` });
  if (flags.length === 0)
    flags.push({ severity: "info", message: `Well spread across ${priced.length} holdings and ${sectorsSorted.length} sectors.` });

  return {
    available: true,
    positions: priced.length,
    hhi,
    effectiveHoldings,
    sectors: sectorsSorted.length,
    hhiSector,
    score,
    grade,
    top1,
    top5Weight,
    topSector,
    flags,
  };
}
