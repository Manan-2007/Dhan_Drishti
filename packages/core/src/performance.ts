import { Decimal, d, ZERO, safeDiv } from "./money.js";
import type { CanonicalTx, Segment } from "./types.js";
import { applyBonus, applyBuy, applySell, applySplit, emptyPosition, type Position } from "./position.js";

/**
 * Performance engine: realised-P&L events (avg-cost) rolled up by segment / month /
 * financial year, dividend income, and money-weighted return (XIRR). Pure & deterministic.
 * See docs/CALCULATIONS.md.
 */

export interface RealisedEvent {
  date: string;
  securityId: string;
  segment: Segment;
  proceeds: Decimal;
  cost: Decimal;
  realised: Decimal; // proceeds - cost - fees - taxes
}

function sortTxs(txs: CanonicalTx[]): CanonicalTx[] {
  return [...txs].sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : a.id < b.id ? -1 : 1));
}

/**
 * Walk the ledger per security (average cost) and emit one realised event per position-closing
 * trade. Uses the same shared position arithmetic as the holdings engine, so realised P&L here
 * always matches Holdings — including short positions, where P&L is realised on the COVERING
 * BUY rather than at the moment of shorting.
 */
export function realisedEvents(txs: CanonicalTx[]): RealisedEvent[] {
  const running = new Map<string, Position>();
  const events: RealisedEvent[] = [];
  for (const tx of sortTxs(txs)) {
    if (!tx.securityId) continue;
    let p = running.get(tx.securityId);
    if (!p) {
      p = emptyPosition();
      running.set(tx.securityId, p);
    }
    const qty = d(tx.quantity);
    const price = d(tx.price);
    const fees = d(tx.fees);
    const taxes = d(tx.taxes);
    if (tx.type === "buy" || tx.type === "transfer_in") {
      const out = applyBuy(p, qty, price, fees, taxes);
      running.set(tx.securityId, out.position);
      if (out.closedSomething) {
        // Covering a short realises (credit received − buy-back cost).
        events.push({
          date: tx.tradeDate,
          securityId: tx.securityId,
          segment: tx.segment,
          proceeds: out.basisReleased,
          cost: qty.times(price),
          realised: out.realised,
        });
      }
    } else if (tx.type === "bonus") {
      running.set(tx.securityId, applyBonus(p, qty));
    } else if (tx.type === "split") {
      // `price` = ratio (new shares per old); qty scales, cost basis unchanged.
      running.set(tx.securityId, applySplit(p, price));
    } else if (tx.type === "sell" || tx.type === "transfer_out") {
      const out = applySell(p, qty, price, fees, taxes);
      running.set(tx.securityId, out.position);
      if (out.closedSomething) {
        events.push({
          date: tx.tradeDate,
          securityId: tx.securityId,
          segment: tx.segment,
          proceeds: out.proceeds,
          cost: out.basisReleased,
          realised: out.realised,
        });
      }
    }
  }
  return events;
}

/** Indian financial year label for a date (Apr–Mar), e.g. "FY 24-25". */
export function financialYear(iso: string): string {
  const dt = new Date(iso);
  const y = dt.getUTCFullYear();
  const start = dt.getUTCMonth() >= 3 ? y : y - 1; // month 3 = April
  const two = (n: number) => String(n % 100).padStart(2, "0");
  return `FY ${two(start)}-${two(start + 1)}`;
}

export interface PeriodRealised {
  key: string;
  realised: Decimal;
  dividends: Decimal;
}

export interface RealisedRollups {
  byFY: PeriodRealised[];
  byMonth: PeriodRealised[];
  bySegment: { key: Segment; realised: Decimal }[];
  totalRealised: Decimal;
  totalDividends: Decimal;
}

/** Roll realised events + dividend transactions up by FY, month, and segment. */
export function rollupRealised(txs: CanonicalTx[]): RealisedRollups {
  const events = realisedEvents(txs);
  const fy = new Map<string, { realised: Decimal; dividends: Decimal }>();
  const month = new Map<string, { realised: Decimal; dividends: Decimal }>();
  const seg = new Map<Segment, Decimal>();
  let totalRealised = ZERO;
  let totalDividends = ZERO;

  const bump = (m: Map<string, { realised: Decimal; dividends: Decimal }>, k: string, field: "realised" | "dividends", v: Decimal) => {
    const cur = m.get(k) ?? { realised: ZERO, dividends: ZERO };
    cur[field] = cur[field].plus(v);
    m.set(k, cur);
  };

  for (const e of events) {
    const mk = e.date.slice(0, 7); // YYYY-MM
    bump(fy, financialYear(e.date), "realised", e.realised);
    bump(month, mk, "realised", e.realised);
    seg.set(e.segment, (seg.get(e.segment) ?? ZERO).plus(e.realised));
    totalRealised = totalRealised.plus(e.realised);
  }
  for (const tx of txs) {
    if (tx.type !== "dividend" && tx.type !== "interest") continue;
    const amt = d(tx.grossAmount);
    bump(fy, financialYear(tx.tradeDate), "dividends", amt);
    bump(month, tx.tradeDate.slice(0, 7), "dividends", amt);
    totalDividends = totalDividends.plus(amt);
  }

  const toArr = (m: Map<string, { realised: Decimal; dividends: Decimal }>): PeriodRealised[] =>
    [...m.entries()].map(([key, v]) => ({ key, realised: v.realised, dividends: v.dividends })).sort((a, b) => (a.key < b.key ? -1 : 1));

  return {
    byFY: toArr(fy),
    byMonth: toArr(month),
    bySegment: [...seg.entries()].map(([key, realised]) => ({ key, realised })).sort((a, b) => b.realised.minus(a.realised).toNumber()),
    totalRealised,
    totalDividends,
  };
}

// ---------- XIRR (money-weighted return) ----------

export interface Cashflow {
  date: string;
  amount: number; // outflows negative (buys/fees), inflows positive (sells/dividends/terminal value)
}

/** Signed cashflows from the ledger (excludes any terminal valuation — caller adds it). */
export function ledgerCashflows(txs: CanonicalTx[]): Cashflow[] {
  const flows: Cashflow[] = [];
  for (const tx of txs) {
    const qty = d(tx.quantity);
    const price = d(tx.price);
    const fees = d(tx.fees);
    const taxes = d(tx.taxes);
    if (tx.type === "buy") flows.push({ date: tx.tradeDate, amount: -qty.times(price).plus(fees).plus(taxes).toNumber() });
    else if (tx.type === "sell") flows.push({ date: tx.tradeDate, amount: qty.times(price).minus(fees).minus(taxes).toNumber() });
    else if (tx.type === "dividend" || tx.type === "interest") flows.push({ date: tx.tradeDate, amount: d(tx.grossAmount).toNumber() });
  }
  return flows;
}

// ---------- Benchmark comparison (index-equivalent / PME-style mirror) ----------

/** One historical index bar. `date` is an ISO calendar day (YYYY-MM-DD). */
export interface BenchmarkBar {
  date: string;
  close: number;
}

/**
 * As-of price lookup: the close on `date`, else the most recent earlier bar (markets are
 * shut on weekends/holidays). `bars` must be sorted ascending by date. Null if none earlier.
 */
export function priceAsOf(bars: BenchmarkBar[], date: string): number | null {
  let found: number | null = null;
  for (const b of bars) {
    if (b.date <= date) found = b.close;
    else break;
  }
  return found;
}

export interface BenchmarkResult {
  units: number; // net index units held at the end
  investedNet: number; // net cash mirrored into the index (Σ outflows − inflows, pre-terminal)
  currentValue: number; // units × latestClose
  gain: number; // currentValue − investedNet
  xirr: number | null; // money-weighted return over the identical cashflow schedule
  matchedFlows: number; // cashflows priced against the index
  unmatchedFlows: number; // cashflows with no index price on/before their date (skipped)
  latestClose: number;
}

/**
 * "What if the very same cashflows had gone into an index instead?" — a public-markets-
 * equivalent mirror. Each portfolio outflow buys index units at that day's close; each
 * inflow sells units. Whatever units remain are valued at `latestClose`. Pure & deterministic.
 * XIRR is over the mirrored flows plus that terminal value, so it lines up 1:1 with the
 * portfolio's own XIRR. Cashflows whose date predates all index data are skipped and counted.
 */
export function simulateBenchmark(cashflows: Cashflow[], bars: BenchmarkBar[], latestClose: number): BenchmarkResult {
  let units = 0;
  let investedNet = 0;
  let matched = 0;
  let unmatched = 0;
  const mirrored: Cashflow[] = [];
  for (const cf of cashflows) {
    const px = priceAsOf(bars, cf.date.slice(0, 10));
    if (px == null || px <= 0) {
      unmatched++;
      continue;
    }
    matched++;
    units += -cf.amount / px; // amount < 0 (money in) buys units; > 0 (money out) sells
    investedNet += -cf.amount;
    mirrored.push(cf);
  }
  const currentValue = units * latestClose;
  const x = mirrored.length ? xirr([...mirrored, { date: new Date().toISOString(), amount: currentValue }]) : null;
  return {
    units,
    investedNet,
    currentValue,
    gain: currentValue - investedNet,
    xirr: x,
    matchedFlows: matched,
    unmatchedFlows: unmatched,
    latestClose,
  };
}

// ---------- Time-weighted return (TWR) ----------

/** A valuation of the portfolio at a date, with the external flow occurring at that date. */
export interface TwrPoint {
  date: string;
  value: number; // market value just BEFORE the flow on this date
  flow: number; // external contribution INTO the portfolio (buys +, sells/dividends −)
}

export interface TwrResult {
  twr: number | null; // cumulative time-weighted return over the whole span
  annualized: number | null;
  subPeriods: number; // how many valued sub-periods were chained
}

/**
 * Linked time-weighted return: chain each sub-period's growth factor
 * `value[k] / (value[k-1] + flow[k-1])`, which strips out the effect of contribution timing
 * (unlike XIRR). Sub-periods that begin with no invested capital are skipped (a fresh start
 * after a full exit), never fabricated. Pure & deterministic.
 */
export function linkedTwr(points: TwrPoint[]): TwrResult {
  if (points.length < 2) return { twr: null, annualized: null, subPeriods: 0 };
  let growth = 1;
  let sub = 0;
  for (let k = 1; k < points.length; k++) {
    const base = points[k - 1]!.value + points[k - 1]!.flow;
    if (base <= 0) continue; // no capital at risk over this gap → start fresh
    const r = points[k]!.value / base;
    if (!Number.isFinite(r) || r <= 0) continue;
    growth *= r;
    sub += 1;
  }
  if (sub === 0) return { twr: null, annualized: null, subPeriods: 0 };
  const twr = growth - 1;
  const t0 = new Date(points[0]!.date).getTime();
  const t1 = new Date(points[points.length - 1]!.date).getTime();
  const years = (t1 - t0) / (365 * 86_400_000);
  const annualized = years > 0 ? Math.pow(growth, 1 / years) - 1 : twr;
  return { twr, annualized, subPeriods: sub };
}

function xnpv(rate: number, flows: { t: number; amount: number }[]): number {
  return flows.reduce((acc, f) => acc + f.amount / Math.pow(1 + rate, f.t), 0);
}
function dXnpv(rate: number, flows: { t: number; amount: number }[]): number {
  return flows.reduce((acc, f) => acc - (f.t * f.amount) / Math.pow(1 + rate, f.t + 1), 0);
}

/**
 * Annualized money-weighted return. Returns null when it can't be solved (needs at least
 * one negative and one positive flow). Newton–Raphson with a bisection fallback.
 */
export function xirr(cashflows: Cashflow[]): number | null {
  if (cashflows.length < 2) return null;
  const hasNeg = cashflows.some((f) => f.amount < 0);
  const hasPos = cashflows.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) return null;

  const t0 = new Date(cashflows[0]!.date).getTime();
  const flows = cashflows.map((f) => ({ t: (new Date(f.date).getTime() - t0) / (365 * 86_400_000), amount: f.amount }));

  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const v = xnpv(rate, flows);
    const dv = dXnpv(rate, flows);
    if (Math.abs(dv) < 1e-12) break;
    const next = rate - v / dv;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-8) return next <= -1 ? null : next;
    rate = next;
  }
  // Bisection fallback on [-0.9999, 100].
  let lo = -0.9999;
  let hi = 100;
  let flo = xnpv(lo, flows);
  const fhi = xnpv(hi, flows);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fmid = xnpv(mid, flows);
    if (Math.abs(fmid) < 1e-7) return mid;
    if (flo * fmid < 0) hi = mid;
    else {
      lo = mid;
      flo = fmid;
    }
  }
  return (lo + hi) / 2;
}
