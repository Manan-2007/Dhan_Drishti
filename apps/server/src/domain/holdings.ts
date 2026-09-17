import { and, eq, inArray, desc } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  computeHoldings,
  cashBalances,
  hasCashAccounting,
  toStore,
  d,
  ZERO,
  type CanonicalTx,
  type Quote as CoreQuote,
  type Holding,
  Decimal,
} from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { transactions, securities, quotes, type Security } from "../db/schema.js";
import { authed } from "../lib/routes.js";
import { getPortfolioOwned } from "./portfolios.js";
import { baseCurrencyOf, rateMap } from "../market/fx.js";

/** Latest quote per security (most recent as_of). */
async function latestQuotes(db: DB, securityIds: string[]): Promise<Map<string, CoreQuote>> {
  const map = new Map<string, CoreQuote>();
  if (securityIds.length === 0) return map;
  const rows = await db
    .select()
    .from(quotes)
    .where(inArray(quotes.securityId, securityIds))
    .orderBy(desc(quotes.asOf))
    .all();
  for (const q of rows) {
    if (!map.has(q.securityId)) {
      map.set(q.securityId, {
        securityId: q.securityId,
        price: q.price,
        prevClose: q.prevClose,
        currency: q.currency,
        asOf: q.asOf,
      });
    }
  }
  return map;
}

interface SerializedHolding {
  security: Pick<Security, "id" | "symbol" | "name" | "assetClass" | "sector" | "currency">;
  netQty: string;
  invested: string;
  avgCost: string | null;
  currentValue: string | null;
  unrealisedPnl: string | null;
  unrealisedPct: string | null;
  realisedPnl: string;
  dividends: string;
  todayChange: string | null;
  netPnl: string | null;
  hasOversell: boolean;
  quote: { price: string; asOf: string } | null;
  // Values converted into the user's base currency (null when no FX rate is available).
  baseInvested: string | null;
  baseCurrentValue: string | null;
  baseRealisedPnl: string | null;
  baseDividends: string | null;
  baseUnrealisedPnl: string | null;
  // FX-impact decomposition (foreign holdings only; null when FX-at-cost is unknown).
  investedBaseAtCost: string | null; // rupees actually deployed, at each buy's FX rate
  avgFxAtCost: string | null; // weighted-average base-per-1-local at cost time
  assetReturnBase: string | null; // return from the asset's local-currency price move
  currencyReturnBase: string | null; // return from the FX rate moving since cost
}

function serialize(h: Holding, sec: Security, quote: CoreQuote | undefined): SerializedHolding {
  return {
    security: {
      id: sec.id,
      symbol: sec.symbol,
      name: sec.name,
      assetClass: sec.assetClass,
      sector: sec.sector,
      currency: sec.currency,
    },
    netQty: h.netQty.toFixed(),
    invested: h.invested.toFixed(),
    avgCost: toStore(h.avgCost),
    currentValue: toStore(h.currentValue),
    unrealisedPnl: toStore(h.unrealisedPnl),
    unrealisedPct: toStore(h.unrealisedPct),
    realisedPnl: h.realisedPnl.toFixed(),
    dividends: h.dividends.toFixed(),
    todayChange: toStore(h.todayChange),
    netPnl: toStore(h.netPnl),
    hasOversell: h.hasOversell,
    quote: quote ? { price: quote.price, asOf: quote.asOf } : null,
    baseInvested: null,
    baseCurrentValue: null,
    baseRealisedPnl: null,
    baseDividends: null,
    baseUnrealisedPnl: null,
    investedBaseAtCost: toStore(h.investedBaseAtCost),
    avgFxAtCost: toStore(h.avgFxAtCost),
    assetReturnBase: null,
    currencyReturnBase: null,
  };
}

/** Fill in base-currency fields on a holding using a conversion rate (null = no rate). */
function convertToBase(h: SerializedHolding, rate: Decimal | null): void {
  if (rate === null) return;
  const conv = (v: string | null) => (v === null ? null : d(v).times(rate).toFixed());
  h.baseInvested = conv(h.invested);
  h.baseCurrentValue = conv(h.currentValue);
  h.baseRealisedPnl = conv(h.realisedPnl);
  h.baseDividends = conv(h.dividends);
  h.baseUnrealisedPnl = conv(h.unrealisedPnl);
}

type Dim = { key: string; value: string; weight: string }[];

// Allocation weights are computed on BASE-currency values so cross-currency slices compare
// apples to apples; holdings without an FX rate are excluded from the weighting.
function groupBy(rows: SerializedHolding[], basis: "current_value" | "invested", keyOf: (r: SerializedHolding) => string): Dim {
  const pick = (r: SerializedHolding) => {
    const v = basis === "current_value" ? r.baseCurrentValue ?? r.baseInvested : r.baseInvested;
    return v === null ? null : d(v);
  };
  const groups = new Map<string, Decimal>();
  let total = ZERO;
  for (const r of rows) {
    const v = pick(r);
    if (v === null || v.lessThanOrEqualTo(0)) continue;
    total = total.plus(v);
    const k = keyOf(r);
    groups.set(k, (groups.get(k) ?? ZERO).plus(v));
  }
  return [...groups.entries()]
    .map(([key, value]) => ({ key, value: value.toFixed(), weight: total.isZero() ? "0" : value.div(total).toFixed() }))
    .sort((a, b) => Number(b.value) - Number(a.value));
}

/** Merge extra {key,value} slices (e.g. cash) into a dimension and re-weight over the new total. */
function withExtra(dim: Dim, extra: { key: string; value: Decimal }[]): Dim {
  const merged = new Map<string, Decimal>();
  for (const r of dim) merged.set(r.key, (merged.get(r.key) ?? ZERO).plus(r.value));
  for (const e of extra) if (e.value.greaterThan(0)) merged.set(e.key, (merged.get(e.key) ?? ZERO).plus(e.value));
  const total = [...merged.values()].reduce((a, b) => a.plus(b), ZERO);
  return [...merged.entries()]
    .map(([key, value]) => ({ key, value: value.toFixed(), weight: total.isZero() ? "0" : value.div(total).toFixed() }))
    .sort((a, b) => Number(b.value) - Number(a.value));
}

function allocation(
  rows: SerializedHolding[],
  cashByCurrency: Map<string, Decimal>, // cash converted to base, per source currency
  cashBase: Decimal,
): {
  basis: "current_value" | "invested";
  byAssetClass: Dim;
  bySector: Dim;
  byCurrency: Dim;
} {
  const allPriced = rows.every((r) => r.currentValue !== null || r.netQty === "0");
  const basis = allPriced && rows.some((r) => r.currentValue !== null) ? "current_value" : "invested";
  // Cash is a base-currency value, so only fold it into a value-based allocation.
  const cashAsset = basis === "current_value" && cashBase.greaterThan(0) ? [{ key: "cash", value: cashBase }] : [];
  const cashCcy = basis === "current_value" ? [...cashByCurrency.entries()].map(([key, value]) => ({ key, value })) : [];
  return {
    basis,
    byAssetClass: withExtra(groupBy(rows, basis, (r) => r.security.assetClass), cashAsset),
    bySector: groupBy(rows, basis, (r) => r.security.sector ?? "Unclassified"),
    byCurrency: withExtra(groupBy(rows, basis, (r) => r.security.currency), cashCcy),
  };
}

const querySchema = z.object({ portfolioId: z.string().optional() });

export async function computePortfolioHoldings(db: DB, userId: string, portfolioId?: string) {
  const clauses = [eq(transactions.userId, userId)];
  if (portfolioId) clauses.push(eq(transactions.portfolioId, portfolioId));
  const txRows = await db
    .select()
    .from(transactions)
    .where(and(...clauses))
    .all();

  const txs = txRows as unknown as CanonicalTx[];
  const securityIds = [...new Set(txRows.map((t) => t.securityId).filter((x): x is string => !!x))];
  const quoteMap = await latestQuotes(db, securityIds);
  const secRows = securityIds.length
    ? await db.select().from(securities).where(inArray(securities.id, securityIds)).all()
    : [];
  const secById = new Map(secRows.map((s) => [s.id, s]));

  const holdings = computeHoldings(txs, { quotes: quoteMap });
  const serialized = holdings
    .map((h) => {
      const sec = secById.get(h.securityId);
      if (!sec) return null;
      return serialize(h, sec, quoteMap.get(h.securityId));
    })
    .filter((x): x is SerializedHolding => x !== null)
    .sort((a, b) => Number(b.currentValue ?? b.invested) - Number(a.currentValue ?? a.invested));

  // Convert every holding into the user's base currency for aggregation.
  const base = await baseCurrencyOf(db, userId);
  // Cash can be in currencies with no held security, so rate over the union of both.
  const cashRaw = cashBalances(txs);
  const allCurrencies = [...new Set([...secRows.map((s) => s.currency), ...cashRaw.keys()])];
  const rates = await rateMap(db, allCurrencies, base);
  const unconvertible = new Set<string>();
  for (const r of serialized) {
    const rate = r.security.currency === base ? d("1") : rates.get(r.security.currency) ?? null;
    convertToBase(r, rate);
    if (rate === null && Number(r.currentValue ?? r.invested) > 0) unconvertible.add(r.security.currency);
  }

  // Summary in base currency (sums over convertible + available figures — no fabrication).
  let invested = ZERO;
  let currentValue = ZERO;
  let unrealised = ZERO;
  let realised = ZERO;
  let dividends = ZERO;
  let priced = 0;
  for (const r of serialized) {
    if (r.baseInvested !== null) invested = invested.plus(r.baseInvested);
    if (r.baseRealisedPnl !== null) realised = realised.plus(r.baseRealisedPnl);
    if (r.baseDividends !== null) dividends = dividends.plus(r.baseDividends);
    if (r.baseCurrentValue !== null) {
      currentValue = currentValue.plus(r.baseCurrentValue);
      unrealised = unrealised.plus(r.baseUnrealisedPnl ?? "0");
      priced += 1;
    }
  }
  const openPositions = serialized.filter((r) => r.netQty !== "0").length;
  const allPriced = priced === openPositions;

  // Cash balance (base currency), converted per source currency. Only surfaced when the ledger
  // actually records cash movements (deposits/withdrawals) — otherwise it isn't meaningful.
  const cashTracked = hasCashAccounting(txs);
  const cashByCurrency = new Map<string, Decimal>();
  let cashBase = ZERO;
  if (cashTracked) {
    for (const [ccy, bal] of cashRaw) {
      const rate = ccy === base ? d("1") : rates.get(ccy) ?? null;
      if (rate === null) {
        if (!bal.isZero()) unconvertible.add(ccy);
        continue;
      }
      const inBase = bal.times(rate);
      cashByCurrency.set(ccy, inBase);
      cashBase = cashBase.plus(inBase);
    }
  }
  const netWorth = currentValue.plus(cashBase); // holdings value + cash (cash 0 unless tracked)

  // FX-impact decomposition: for each priced FOREIGN holding, split the base-currency gain
  // into the part from the asset's own price move (valued at cost-time FX) and the part from
  // the FX rate itself moving since cost. asset + currency = value·fx_now − cost·fx_at_cost.
  let assetReturn = ZERO;
  let currencyReturn = ZERO;
  let decomposable = 0;
  const missingCostFx = new Set<string>();
  for (const r of serialized) {
    if (r.security.currency === base) continue; // no currency component for base-currency holdings
    if (r.netQty === "0" || r.currentValue === null) continue; // need a current value
    const fxNow = rates.get(r.security.currency) ?? null; // base per 1 local, current
    if (fxNow === null) continue; // unpriced FX already flagged as unconvertible
    if (r.avgFxAtCost === null) {
      missingCostFx.add(r.security.currency); // foreign holding without FX-at-cost → can't split
      continue;
    }
    const invLocal = d(r.invested);
    const cvLocal = d(r.currentValue);
    const fxCost = d(r.avgFxAtCost);
    const asset = cvLocal.minus(invLocal).times(fxCost);
    const currency = cvLocal.times(fxNow.minus(fxCost));
    r.assetReturnBase = asset.toFixed();
    r.currencyReturnBase = currency.toFixed();
    assetReturn = assetReturn.plus(asset);
    currencyReturn = currencyReturn.plus(currency);
    decomposable += 1;
  }
  const fxImpact =
    decomposable > 0 || missingCostFx.size > 0
      ? {
          assetReturn: assetReturn.toFixed(),
          currencyReturn: currencyReturn.toFixed(),
          total: assetReturn.plus(currencyReturn).toFixed(),
          decomposablePositions: decomposable,
          missingCostFxCurrencies: [...missingCostFx],
        }
      : null;

  return {
    baseCurrency: base,
    fxComplete: unconvertible.size === 0,
    unconvertibleCurrencies: [...unconvertible],
    fxImpact,
    cashTracked,
    summary: {
      invested: invested.toFixed(),
      currentValue: currentValue.toFixed(),
      unrealisedPnl: unrealised.toFixed(),
      realisedPnl: realised.toFixed(),
      dividends: dividends.toFixed(),
      netPnl: unrealised.plus(realised).plus(dividends).toFixed(),
      cash: cashBase.toFixed(),
      netWorth: netWorth.toFixed(),
      openPositions,
      pricedPositions: priced,
      allPriced,
    },
    allocation: allocation(serialized, cashByCurrency, cashBase),
    holdings: serialized,
  };
}

export function registerHoldingsRoutes(app: FastifyInstance, db: DB): void {
  const opts = authed(app);
  app.get("/api/holdings", opts, async (req) => {
    const { portfolioId } = querySchema.parse(req.query);
    const userId = req.user!.id;
    if (portfolioId) await getPortfolioOwned(db, userId, portfolioId); // ownership guard
    return computePortfolioHoldings(db, userId, portfolioId);
  });
}
