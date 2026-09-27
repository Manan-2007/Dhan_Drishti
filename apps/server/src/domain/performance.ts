import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { rollupRealised, ledgerCashflows, withoutUnmatchedSales, xirr, simulateBenchmark, benchmarkSeries, linkedTwr, priceAsOf, cashDeltas, cashBalanceAsOf, cashTrackedAccounts, d, ZERO, toStore, type CanonicalTx, type TwrPoint } from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { transactions, securities } from "../db/schema.js";
import { authed } from "../lib/routes.js";
import { BadRequestError } from "../lib/errors.js";
import type { BenchmarkProvider, SecurityHistoryProvider, BenchmarkBar } from "../market/types.js";
import { BENCHMARKS, getBenchmark } from "../market/benchmarks.js";
import { baseCurrencyOf, rateMap } from "../market/fx.js";
import { getPortfolioOwned } from "./portfolios.js";
import { computePortfolioHoldings } from "./holdings.js";
import { getNetWorthSeries } from "./snapshots.js";

const querySchema = z.object({ portfolioId: z.string().optional() });
const RANGES: Record<string, number | null> = { "1m": 30, "3m": 90, "6m": 182, "1y": 365, max: null };
const netWorthQuerySchema = z.object({ portfolioId: z.string().optional(), range: z.enum(["1m", "3m", "6m", "1y", "max"]).default("max") });
const benchmarkQuerySchema = z.object({ portfolioId: z.string().optional(), benchmark: z.string().min(1) });

/**
 * The ledger's money-weighted cashflows (buys −, sells +, income +), every one in the base
 * currency — a foreign trade at its FX-at-cost, else today's rate (the scheduler backfills
 * FX-at-cost, so that fallback is temporary). Sales of shares bought before the history are left
 * out: with no purchase to set against them, their whole proceeds would read as return.
 * `fxMissing` when some foreign flow has no rate at all.
 */
async function baseCashflows(db: DB, userId: string, txRows: CanonicalTx[]) {
  const base = await baseCurrencyOf(db, userId);
  const foreign = [...new Set(txRows.filter((t) => t.currency !== base).map((t) => t.currency))];
  const today = await rateMap(db, foreign, base);
  const rateOf = (t: CanonicalTx) => (t.currency === base ? 1 : t.fxRateToBase ? Number(t.fxRateToBase) : Number(today.get(t.currency) ?? NaN));
  const flows = ledgerCashflows(withoutUnmatchedSales(txRows), rateOf);
  return { base, flows, fxMissing: flows.some((f) => !Number.isFinite(f.amount)) };
}

export async function computePerformance(db: DB, userId: string, portfolioId?: string) {
  const clauses = [eq(transactions.userId, userId)];
  if (portfolioId) clauses.push(eq(transactions.portfolioId, portfolioId));
  const txRows = (await db
    .select()
    .from(transactions)
    .where(and(...clauses))
    .all()) as unknown as CanonicalTx[];

  const roll = rollupRealised(txRows);
  const holdings = await computePortfolioHoldings(db, userId, portfolioId);
  const s = holdings.summary;

  // XIRR needs a terminal value for still-open positions; only compute when every open
  // position is priced (or nothing is open). Otherwise it would be misleading → null.
  const { flows, fxMissing } = await baseCashflows(db, userId, txRows);
  let xirrValue: number | null = null;
  let xirrAvailable = false;
  if (fxMissing) {
    // leave unavailable
  } else if (s.openPositions === 0) {
    xirrAvailable = true;
    xirrValue = xirr(flows);
  } else if (s.allPriced && Number(s.currentValue) > 0) {
    xirrAvailable = true;
    xirrValue = xirr([...flows, { date: new Date().toISOString(), amount: Number(s.currentValue) }]);
  }

  return {
    summary: {
      invested: s.invested,
      currentValue: s.currentValue,
      unrealisedPnl: s.unrealisedPnl,
      realisedPnl: toStore(roll.totalRealised),
      dividends: toStore(roll.totalDividends),
      netPnl: s.netPnl,
      openPositions: s.openPositions,
      allPriced: s.allPriced,
    },
    xirr: xirrValue,
    xirrAvailable,
    byFY: roll.byFY.map((p) => ({ key: p.key, realised: toStore(p.realised), dividends: toStore(p.dividends) })),
    byMonth: roll.byMonth.map((p) => ({ key: p.key, realised: toStore(p.realised), dividends: toStore(p.dividends) })),
    bySegment: roll.bySegment.map((seg) => ({ key: seg.key, realised: toStore(seg.realised) })),
  };
}

/**
 * "What if the same cashflows had gone into an index instead?" — compares the portfolio's
 * money-weighted return against a mirror of its own cashflows invested in the chosen index.
 * The head-to-head XIRR needs a portfolio terminal value, so it's only `available` when the
 * portfolio's own XIRR is (every open position priced, or nothing open).
 */
export async function computeBenchmark(
  db: DB,
  userId: string,
  provider: BenchmarkProvider,
  benchmarkId: string,
  portfolioId?: string,
) {
  const benchmark = getBenchmark(benchmarkId);
  if (!benchmark) throw new BadRequestError("unknown_benchmark", `No such benchmark: ${benchmarkId}`);

  const clauses = [eq(transactions.userId, userId)];
  if (portfolioId) clauses.push(eq(transactions.portfolioId, portfolioId));
  const txRows = (await db
    .select()
    .from(transactions)
    .where(and(...clauses))
    .all()) as unknown as CanonicalTx[];

  // The same cashflows as the portfolio's own XIRR, so the two returns compare like for like.
  const { base, flows, fxMissing } = await baseCashflows(db, userId, txRows);
  const meta = { benchmarkId: benchmark.id, label: benchmark.label, symbol: benchmark.symbol };
  const unavailable = (reason: string) => ({ ...meta, available: false, reason, portfolio: null, index: null });
  if (flows.length === 0) return unavailable("No cashflows to compare yet.");
  if (fxMissing) return unavailable("Some foreign trades have no exchange rate yet. They fill in automatically within a few hours.");

  const perf = await computePerformance(db, userId, portfolioId);

  // Only the public index symbol + a date range leave the machine — never any holdings.
  const from = flows.reduce((min, f) => (f.date < min ? f.date : min), flows[0]!.date).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const bars = await provider.getHistory(benchmark.symbol, from, today);
  if (bars.length === 0) return unavailable("Benchmark price history is unavailable right now.");

  const latest = bars[bars.length - 1]!;
  const bench = simulateBenchmark(flows, bars, latest.close);
  const series = benchmarkSeries(flows, bars);

  // Cashflows are in the base currency; exact when that's the index's own (INR vs an Indian index).
  const currencyNote = base !== benchmark.currency ? `Your figures are in ${base}; ${benchmark.label} is in ${benchmark.currency}, so the comparison mixes currencies.` : undefined;

  return {
    ...meta,
    available: perf.xirrAvailable,
    reason: perf.xirrAvailable ? undefined : "Needs current prices for open positions before returns can be compared.",
    from,
    asOf: latest.date,
    currencyNote,
    currency: benchmark.currency,
    // Overlay: net contributed vs the index-mirror's value over time (index currency).
    series: series.map((p) => ({ date: p.date, invested: p.invested, index: p.index })),
    portfolio: {
      xirr: perf.xirr,
      currentValue: perf.summary.currentValue,
      investedNet: String(-flows.reduce((s, f) => s + f.amount, 0)),
    },
    index: {
      xirr: bench.xirr,
      currentValue: String(bench.currentValue),
      investedNet: String(bench.investedNet),
      gain: String(bench.gain),
      matchedFlows: bench.matchedFlows,
      unmatchedFlows: bench.unmatchedFlows,
      latestClose: bench.latestClose,
    },
  };
}

/** Net quantity of one security from its qty-affecting txs strictly before `day` (splits/bonus honored). */
function netQtyBefore(txs: CanonicalTx[], day: string): number {
  let qty = ZERO;
  for (const tx of txs) {
    if (tx.tradeDate.slice(0, 10) >= day) continue;
    if (tx.type === "buy" || tx.type === "transfer_in" || tx.type === "bonus") qty = qty.plus(d(tx.quantity));
    else if (tx.type === "sell" || tx.type === "transfer_out") qty = qty.minus(d(tx.quantity));
    else if (tx.type === "split" && d(tx.price).greaterThan(0)) qty = qty.times(d(tx.price));
  }
  return qty.toNumber();
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/**
 * Time-weighted return (TWR): the money-weighting-free performance of the holdings, chaining
 * each buy/sell sub-period's price growth. It values the portfolio at every buy/sell date from
 * real historical prices, so it needs single-currency holdings with price history for each
 * security (mutual funds have none → honestly reported as uncovered). Dividends are income,
 * shown separately, and are not treated as flows here (we don't track a cash balance).
 */
export async function computeTwr(db: DB, userId: string, historyProvider: SecurityHistoryProvider, portfolioId?: string) {
  const clauses = [eq(transactions.userId, userId)];
  if (portfolioId) clauses.push(eq(transactions.portfolioId, portfolioId));
  const txs = (await db.select().from(transactions).where(and(...clauses)).all()) as unknown as CanonicalTx[];
  const unavailable = (reason: string, extra: Record<string, unknown> = {}) => ({ available: false as const, reason, ...extra });
  if (txs.length === 0) return unavailable("No transactions yet.");

  const base = await baseCurrencyOf(db, userId);
  const secIds = [...new Set(txs.map((t) => t.securityId).filter((x): x is string => !!x))];
  const secRows = secIds.length ? await db.select().from(securities).where(inArray(securities.id, secIds)).all() : [];
  const foreign = [...new Set(secRows.map((s) => s.currency).filter((c) => c !== base))];
  if (foreign.length) return unavailable(`Time-weighted return needs a single currency; this scope also holds ${foreign.join(", ")}.`);

  // Per account, two modes. An account that records its deposits/withdrawals is valued as holdings
  // + cash, and only those deposits/withdrawals are external flows — dividends and sale proceeds
  // stay *retained* as cash. For any other account (a tradebook alone), its buys/sells are the
  // external flows and only its holdings count. A family mixes both, account by account.
  const tracked = cashTrackedAccounts(txs);
  const inCash = (tx: CanonicalTx) => tracked.has(tx.accountId ?? "");
  const allCash = txs.every(inCash);
  const anyCash = tracked.size > 0;
  const deltas = cashDeltas(txs.filter(inCash));
  const flowByDate = new Map<string, number>();
  // Buy/sell flows (untracked accounts) leave out sales of shares bought before the history — the
  // valuation never held them, so they'd look like money taken out of thin air.
  for (const tx of [...txs.filter(inCash), ...withoutUnmatchedSales(txs.filter((t) => !inCash(t)))]) {
    const day = tx.tradeDate.slice(0, 10);
    if (inCash(tx)) {
      if (tx.type === "deposit") flowByDate.set(day, (flowByDate.get(day) ?? 0) + d(tx.grossAmount).abs().toNumber());
      else if (tx.type === "withdrawal") flowByDate.set(day, (flowByDate.get(day) ?? 0) - d(tx.grossAmount).abs().toNumber());
    } else {
      if (tx.type === "buy") flowByDate.set(day, (flowByDate.get(day) ?? 0) + d(tx.quantity).times(d(tx.price)).plus(d(tx.fees)).plus(d(tx.taxes)).toNumber());
      else if (tx.type === "sell") flowByDate.set(day, (flowByDate.get(day) ?? 0) - d(tx.quantity).times(d(tx.price)).minus(d(tx.fees)).minus(d(tx.taxes)).toNumber());
    }
  }
  const boundaryDates = [...flowByDate.keys()].sort();
  if (boundaryDates.length === 0) return unavailable(allCash ? "No deposits or withdrawals to measure yet." : "No buy/sell activity to measure yet.");

  const from = boundaryDates[0]!;
  const today = new Date().toISOString().slice(0, 10);
  const cashStrictlyBefore = (day: string) => deltas.filter((e) => e.currency === base && e.date.slice(0, 10) < day).reduce((a, e) => a + e.amount.toNumber(), 0);

  // Only public tickers + a date range are sent — never holdings.
  const histBySec = new Map<string, BenchmarkBar[]>();
  await inBatches(secRows, 5, async (sec) => {
    const bars = await historyProvider.getHistory({ id: sec.id, symbol: sec.symbol, isin: sec.isin, amfiCode: sec.amfiCode, assetClass: sec.assetClass, exchange: sec.exchange, currency: sec.currency }, from, today);
    histBySec.set(sec.id, bars);
  });
  const txsBySec = new Map<string, CanonicalTx[]>();
  for (const tx of txs) if (tx.securityId) (txsBySec.get(tx.securityId) ?? txsBySec.set(tx.securityId, []).get(tx.securityId)!).push(tx);

  const missing = new Set<string>();
  const points: TwrPoint[] = [];
  for (const day of boundaryDates) {
    let value = cashStrictlyBefore(day); // cash held just before this date's flow (tracked accounts only)
    for (const sec of secRows) {
      const q = netQtyBefore(txsBySec.get(sec.id) ?? [], day);
      if (q <= 0) continue;
      const px = priceAsOf(histBySec.get(sec.id) ?? [], day);
      if (px == null) missing.add(sec.symbol);
      else value += q * px;
    }
    points.push({ date: day, value, flow: flowByDate.get(day)! });
  }

  const holdings = await computePortfolioHoldings(db, userId, portfolioId);
  if (holdings.summary.openPositions > 0 && !holdings.summary.allPriced) return unavailable("Refresh prices for all open positions first.");
  // Holdings plus the cash of tracked accounts — the same thing each earlier point measures.
  const endValue = Number(holdings.summary.currentValue) + (anyCash ? Number(holdings.summary.cash) : 0);
  points.push({ date: today, value: endValue, flow: 0 });

  if (missing.size) return unavailable(`No price history for ${[...missing].join(", ")} (e.g. mutual funds), so TWR can't be valued.`, { missingHistory: [...missing] });

  const r = linkedTwr(points);
  if (r.twr === null) return unavailable("Not enough valued history to compute TWR.");
  const mode = allCash ? ("cash-inclusive" as const) : anyCash ? ("mixed" as const) : ("holdings" as const);
  return { available: true as const, mode, from, asOf: today, twr: r.twr, annualized: r.annualized, subPeriods: r.subPeriods };
}

export function registerPerformanceRoutes(app: FastifyInstance, db: DB, benchmarkProvider: BenchmarkProvider, historyProvider: SecurityHistoryProvider): void {
  const opts = authed(app);
  app.get("/api/performance/summary", opts, async (req) => {
    const { portfolioId } = querySchema.parse(req.query);
    if (portfolioId) await getPortfolioOwned(db, req.user!.id, portfolioId);
    return computePerformance(db, req.user!.id, portfolioId);
  });

  app.get("/api/performance/benchmarks", opts, async () => ({
    benchmarks: BENCHMARKS.map((b) => ({ id: b.id, label: b.label })),
  }));

  app.get("/api/performance/benchmark", opts, async (req) => {
    const { portfolioId, benchmark } = benchmarkQuerySchema.parse(req.query);
    if (portfolioId) await getPortfolioOwned(db, req.user!.id, portfolioId);
    return computeBenchmark(db, req.user!.id, benchmarkProvider, benchmark, portfolioId);
  });

  app.get("/api/performance/twr", opts, async (req) => {
    const { portfolioId } = querySchema.parse(req.query);
    if (portfolioId) await getPortfolioOwned(db, req.user!.id, portfolioId);
    return computeTwr(db, req.user!.id, historyProvider, portfolioId);
  });

  // Net-worth-over-time series for the dashboard chart + windowed returns.
  app.get("/api/performance/networth", opts, async (req) => {
    const { portfolioId, range } = netWorthQuerySchema.parse(req.query);
    if (portfolioId) await getPortfolioOwned(db, req.user!.id, portfolioId);
    const days = RANGES[range];
    const from = days == null ? undefined : new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    return getNetWorthSeries(db, req.user!.id, portfolioId, from);
  });
}
