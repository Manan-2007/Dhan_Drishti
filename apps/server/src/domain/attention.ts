import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { computeHoldings, d, type CanonicalTx, type Holding } from "@dhan-drishti/core";
import type { DB } from "../db/index.js";
import { accounts, portfolios, securities, splitReviews, transactions, type Security, type Transaction } from "../db/schema.js";
import { authed } from "../lib/routes.js";
import { SNAPSHOT_SOURCE } from "../import/snapshot.js";
import { EXPIRY_SOURCE } from "../import/expiry.js";
import { SPLIT_SOURCE } from "../market/splits.js";
import { monthlyExpiryDay, parseDerivativeSymbol } from "../market/derivative-symbol.js";
import { computePortfolioHoldings } from "./holdings.js";
import { scopeFromRequest, type Scope } from "./scope.js";
import { baseCurrencyOf } from "../market/fx.js";

/**
 * Needs attention: everything missing or uncertain in the data, pinned down to the account, the
 * stock and the file (with its dates) that would fix it. Worked out from the ledger itself — what's
 * there and what isn't — so every line can be traced to real rows.
 */

export type AttentionSeverity = "high" | "warn" | "info" | "done";
export interface AttentionItem {
  id: string;
  kind: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  account: { id: string | null; name: string; broker: string; person: string } | null;
  stocks: { id: string; symbol: string; name: string; note?: string }[];
  /** The file that fixes it: what it is, the help guide for getting it, and the dates it must cover. */
  need: { file: string; guide: string | null; from: string | null; to: string | null; segment?: string } | null;
  fix: "add_files" | "refresh_prices" | "check_splits" | null;
}

const DERIVED = new Set([SNAPSHOT_SOURCE, EXPIRY_SOURCE, SPLIT_SOURCE]);
/** Sources that report on a period rather than list every trade — they don't count as trade files. */
const partialSource = (s: string | null) => !s || s === "dividends" || s === "funds" || s.endsWith("-pnl") || s.endsWith("taxpnl");

const TRADE_FILE: Record<string, { file: string; guide: string | null }> = {
  zerodha: { file: "Zerodha tradebook (Console → Reports → Tradebook)", guide: "zerodha" },
  dhan: { file: "Dhan transaction report (Reports → All Transactions)", guide: "dhan-txn" },
  vested: { file: "Vested transactions statement (Account → Reports)", guide: "vested" },
  ibkr: { file: "Interactive Brokers activity statement", guide: "ibkr" },
  binance: { file: "Binance transaction history", guide: "binance" },
  crypto: { file: "your exchange's transaction history", guide: "binance" },
  generic: { file: "your broker's trade history (CSV)", guide: "generic" },
};
const DIVIDEND_FILE: Record<string, { file: string; guide: string | null }> = {
  zerodha: { file: "Zerodha tax P&L (Console → Reports → Tax P&L) — its Dividends sheet", guide: null },
  dhan: { file: "Dhan dividend payout report", guide: "dividends" },
  vested: { file: "Vested dividends & income statement", guide: "dividends" },
  ibkr: { file: "Interactive Brokers activity statement (it lists dividends)", guide: "ibkr" },
};
const SEVERITY_ORDER: Record<AttentionSeverity, number> = { high: 0, warn: 1, info: 2, done: 3 };
const DAY = 86_400_000;

const day = (iso: string) => iso.slice(0, 10);
const shift = (iso: string, n: number) => new Date(Date.parse(`${day(iso)}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${day(b)}T00:00:00Z`) - Date.parse(`${day(a)}T00:00:00Z`)) / DAY);
const longDate = (iso: string) => new Date(`${day(iso)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmtMoney = (v: string | number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(v));
  } catch {
    return `${currency} ${Number(v).toFixed(2)}`;
  }
};
const fmtQty = (q: string | number) => String(Number(Number(q).toPrecision(8)));

function contractExpiry(sec: Security): string | null {
  const p = parseDerivativeSymbol(sec.symbol, sec.name);
  if (!p) return null;
  return p.expiryApprox ? monthlyExpiryDay(p.expiryISO) : p.expiryISO;
}

export async function computeAttention(db: DB, userId: string, scope: Scope): Promise<{ items: AttentionItem[]; baseCurrency: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const base = await baseCurrencyOf(db, userId);
  const people = await db.select().from(portfolios).where(eq(portfolios.userId, userId)).all();
  const personOf = new Map(people.map((p) => [p.id, p.name]));
  const inPeople = (pid: string) => !scope.portfolioIds?.length || scope.portfolioIds.includes(pid);
  const allAccounts = (await db.select().from(accounts).where(eq(accounts.userId, userId)).all()).filter((a) => inPeople(a.portfolioId));
  const shownAccounts = allAccounts.filter((a) => !scope.brokers?.length || scope.brokers.includes(a.broker));
  const ledger = (await db.select().from(transactions).where(eq(transactions.userId, userId)).all()).filter((t) => inPeople(t.portfolioId));
  const secIds = [...new Set(ledger.map((t) => t.securityId).filter((x): x is string => !!x))];
  const secs = new Map((secIds.length ? await db.select().from(securities).where(inArray(securities.id, secIds)).all() : []).map((s) => [s.id, s]));
  const stock = (id: string, note?: string) => {
    const s = secs.get(id);
    return { id, symbol: s?.symbol ?? "?", name: s?.name ?? "", ...(note ? { note } : {}) };
  };

  const items: AttentionItem[] = [];
  const groups: { key: string; account: AttentionItem["account"]; broker: string; rows: Transaction[] }[] = [];
  for (const a of shownAccounts)
    groups.push({ key: a.id, account: { id: a.id, name: a.name, broker: a.broker, person: personOf.get(a.portfolioId) ?? "" }, broker: a.broker, rows: ledger.filter((t) => t.accountId === a.id) });
  if (!scope.brokers?.length)
    for (const p of people.filter((p) => inPeople(p.id))) {
      const rows = ledger.filter((t) => t.portfolioId === p.id && !t.accountId);
      if (rows.length) groups.push({ key: `p:${p.id}`, account: { id: null, name: `${p.name} · entered by hand`, broker: "manual", person: p.name }, broker: "manual", rows });
    }

  for (const g of groups) {
    const acc = g.account!;
    const label = acc.name;
    const trade = TRADE_FILE[g.broker] ?? null;
    const own = g.rows.filter((t) => !DERIVED.has(t.sourceBroker ?? ""));
    const tradesOwn = own.filter((t) => t.type === "buy" || t.type === "sell");

    // Nothing in this account at all.
    if (g.rows.length === 0) {
      if (g.broker !== "manual")
        items.push({
          id: `no_files:${g.key}`,
          kind: "no_files",
          severity: "warn",
          title: `Nothing added for ${label} yet`,
          detail: `This account has no trades. Add its trade history and it fills in — holdings, profit and tax all come from it.`,
          account: acc,
          stocks: [],
          need: trade ? { ...trade, from: null, to: null } : null,
          fix: "add_files",
        });
      continue;
    }

    const holdings = computeHoldings(g.rows as unknown as CanonicalTx[], {});
    const start = tradesOwn.map((t) => t.tradeDate).sort()[0] ?? null;
    const segmentOf = (sid: string) => (g.rows.some((t) => t.securityId === sid && (t.segment === "fno" || t.segment === "commodity")) ? "F&O" : "Equity");
    const segments = (ids: string[]) => {
      const set = new Set(ids.map(segmentOf));
      return set.size > 1 ? "Equity and F&O" : [...set][0];
    };

    // Sold, with no purchase on record: bought before this account's files begin.
    const unmatched = holdings.filter((h) => h.soldWithoutPurchase.gt(0));
    if (unmatched.length && start) {
      const cur = (sid: string) => secs.get(sid)?.currency ?? base;
      items.push({
        id: `missing_buys:${g.key}`,
        kind: "missing_buys",
        severity: "warn",
        title: `${plural(unmatched.length, "stock")} in ${label} sold with no purchase on record`,
        detail: `These were sold from shares bought before your files for this account begin (${longDate(start)}). Without the purchase, the profit on them isn't counted and they're left out of your tax report. The trade history from when you bought them up to ${longDate(shift(start, -1))} fills it in.`,
        account: acc,
        stocks: unmatched.map((h) => {
          const firstSell = g.rows.filter((t) => t.securityId === h.securityId && t.type === "sell").map((t) => t.tradeDate).sort()[0];
          return stock(h.securityId, `${fmtQty(h.soldWithoutPurchase.toFixed())} sold${firstSell ? ` from ${longDate(firstSell)}` : ""} for ${fmtMoney(h.soldWithoutPurchaseProceeds.toFixed(), cur(h.securityId))}`);
        }),
        need: trade ? { ...trade, from: null, to: shift(start, -1), segment: segments(unmatched.map((h) => h.securityId)) } : null,
        fix: "add_files",
      });
    }

    // Gaps between the files: each file's trades span a stretch; a long break between two is suspect.
    const byBatch = new Map<string, string[]>();
    for (const t of tradesOwn) {
      if (!t.importBatchId || partialSource(t.sourceBroker)) continue;
      byBatch.set(t.importBatchId, [...(byBatch.get(t.importBatchId) ?? []), day(t.tradeDate)]);
    }
    const spans = [...byBatch.values()].map((ds) => ds.sort()).map((ds) => ({ from: ds[0]!, to: ds.at(-1)! })).sort((a, b) => (a.from < b.from ? -1 : 1));
    const merged: { from: string; to: string }[] = [];
    for (const s of spans) {
      const last = merged.at(-1);
      if (last && daysBetween(last.to, s.from) <= 45) last.to = s.to > last.to ? s.to : last.to;
      else merged.push({ ...s });
    }
    for (let i = 1; i < merged.length; i++) {
      const gapFrom = shift(merged[i - 1]!.to, 1);
      const gapTo = shift(merged[i]!.from, -1);
      items.push({
        id: `file_gap:${g.key}:${gapFrom}`,
        kind: "file_gap",
        severity: "info",
        title: `No ${label} files cover ${longDate(gapFrom)} – ${longDate(gapTo)}`,
        detail: `Your files for this account stop on ${longDate(merged[i - 1]!.to)} and pick up again on ${longDate(merged[i]!.from)}. If you traded in between, add the trade history for those dates; if you didn't, there's nothing to do.`,
        account: acc,
        stocks: [],
        need: trade ? { ...trade, from: gapFrom, to: gapTo } : null,
        fix: "add_files",
      });
    }

    // Files that stop a while ago while the account still holds things.
    const fileEnd = merged.at(-1)?.to ?? null;
    const holdsSomething = holdings.some((h) => h.netQty.gt(0) && !(secs.get(h.securityId) && contractExpiry(secs.get(h.securityId)!)));
    if (fileEnd && holdsSomething && daysBetween(fileEnd, today) > 45) {
      const gap = daysBetween(fileEnd, today);
      items.push({
        id: `stale_files:${g.key}`,
        kind: "stale_files",
        severity: gap > 120 ? "warn" : "info",
        title: `${label}'s files end on ${longDate(fileEnd)}`,
        detail: `That's ${plural(gap, "day")} ago. Anything bought or sold since isn't here, so holdings, profit and dividends may be out of date. Add the trade history from ${longDate(shift(fileEnd, 1))} to today.`,
        account: acc,
        stocks: [],
        need: trade ? { ...trade, from: shift(fileEnd, 1), to: today } : null,
        fix: "add_files",
      });
    }

    // Shares held a while, but no dividends on record for the account.
    const dividendFile = DIVIDEND_FILE[g.broker];
    const longHeld = holdings.filter((h) => {
      const s = secs.get(h.securityId);
      if (!s || s.assetClass !== "equity" || !h.netQty.gt(0)) return false;
      const firstBuy = g.rows.filter((t) => t.securityId === h.securityId && t.type === "buy").map((t) => t.tradeDate).sort()[0];
      return !!firstBuy && daysBetween(firstBuy, today) > 120;
    });
    if (dividendFile && longHeld.length && !g.rows.some((t) => t.type === "dividend" || t.type === "interest")) {
      items.push({
        id: `no_dividends:${g.key}`,
        kind: "no_dividends",
        severity: "info",
        title: `No dividends recorded for ${label}`,
        detail: `You've held ${plural(longHeld.length, "share")} here for over four months and no dividend is on record. If any paid out, the dividend statement adds them to your income and returns.`,
        account: acc,
        stocks: longHeld.slice(0, 12).map((h) => stock(h.securityId)),
        need: { ...dividendFile, from: start, to: today },
        fix: "add_files",
      });
    }

    // From the holdings statement: opening balances (bought before the files) and shortfalls.
    const opening = g.rows.filter((t) => t.sourceBroker === SNAPSHOT_SOURCE && t.type === "buy");
    if (opening.length && start) {
      items.push({
        id: `opening:${g.key}`,
        kind: "opening_balance",
        severity: "info",
        title: `${plural(opening.length, "holding")} in ${label} start from your holdings statement`,
        detail: `They were bought before your trade files begin, so they're counted at the broker's average price with no purchase date — and the purchase date decides short- or long-term tax. The trade history from when you bought them up to ${longDate(shift(start, -1))} gives the real dates and prices.`,
        account: acc,
        stocks: opening.map((t) => stock(t.securityId!, `${fmtQty(t.quantity)} at ${fmtMoney(t.price, t.currency)}`)),
        need: trade ? { ...trade, from: null, to: shift(start, -1), segment: segments(opening.map((t) => t.securityId!)) } : null,
        fix: "add_files",
      });
    }
    const short = g.rows.filter((t) => t.sourceBroker === SNAPSHOT_SOURCE && t.type === "transfer_out");
    if (short.length) {
      const asOf = day(short[0]!.tradeDate);
      const lastTrade = tradesOwn.map((t) => t.tradeDate).sort().at(-1);
      items.push({
        id: `statement_short:${g.key}`,
        kind: "statement_short",
        severity: "warn",
        title: `Your ${label} holdings statement shows fewer shares than your trades`,
        detail: `On ${longDate(asOf)} the statement lists fewer of these than your trades add up to — most likely sales missing from your files. They're written down at cost for now, so no profit is invented. The trade history up to ${longDate(asOf)} puts the real sales in.`,
        account: acc,
        stocks: short.map((t) => stock(t.securityId!, `${fmtQty(t.quantity)} fewer`)),
        need: trade ? { ...trade, from: lastTrade ? shift(lastTrade, 1) : null, to: asOf } : null,
        fix: "add_files",
      });
    }

    // F&O: settled at expiry from the exchange price (estimated), or past expiry with no price at all.
    const settled = [...new Set(g.rows.filter((t) => t.sourceBroker === EXPIRY_SOURCE && t.securityId).map((t) => t.securityId!))];
    if (settled.length) {
      const expiries = settled.map((id) => (secs.get(id) ? contractExpiry(secs.get(id)!) : null)).filter((x): x is string => !!x).sort();
      const lastOwn = own.filter((t) => settled.includes(t.securityId ?? "")).map((t) => t.tradeDate).sort().at(-1);
      items.push({
        id: `expiry:${g.key}`,
        kind: "expiry_estimated",
        severity: "info",
        title: `${plural(settled.length, "contract")} in ${label} settled at expiry (estimated)`,
        detail: `Your files show them still open when they expired, so each is closed at the exchange's final price. If you closed any earlier, the F&O trade history up to its expiry replaces the estimate.`,
        account: acc,
        stocks: settled.map((id) => {
          const exp = secs.get(id) ? contractExpiry(secs.get(id)!) : null;
          return stock(id, exp ? `expired ${longDate(exp)}` : undefined);
        }),
        need: trade ? { ...trade, from: lastOwn ? shift(lastOwn, 1) : null, to: expiries.at(-1) ?? null, segment: "F&O" } : null,
        fix: "add_files",
      });
    }
    const stuck = holdings.filter((h: Holding) => {
      const s = secs.get(h.securityId);
      const exp = s ? contractExpiry(s) : null;
      return !h.netQty.isZero() && !!exp && exp < today;
    });
    if (stuck.length) {
      const expiries = stuck.map((h) => contractExpiry(secs.get(h.securityId)!)!).sort();
      items.push({
        id: `expired_open:${g.key}`,
        kind: "expired_open",
        severity: "warn",
        title: `${plural(stuck.length, "contract")} in ${label} still open after expiry`,
        detail: `No closing trade in your files and no public price to settle them (commodity contracts have none), so they still count as open. The trade history up to their expiry closes them.`,
        account: acc,
        stocks: stuck.map((h) => stock(h.securityId, `${fmtQty(h.netQty.toFixed())} open · expired ${longDate(contractExpiry(secs.get(h.securityId)!)!)}`)),
        need: trade ? { ...trade, from: null, to: expiries.at(-1)!, segment: segments(stuck.map((h) => h.securityId)) } : null,
        fix: "add_files",
      });
    }
  }

  // Across the chosen people / brokers: prices and exchange rates.
  const h = await computePortfolioHoldings(db, userId, scope);
  const open = h.holdings.filter((r) => r.netQty !== "0" && !r.expired);
  const unpriced = open.filter((r) => r.quote === null);
  if (unpriced.length)
    items.push({
      id: "unpriced",
      kind: "unpriced",
      severity: "warn",
      title: `${plural(unpriced.length, "holding")} without a current price`,
      detail: `They count at what you paid until a price arrives, so your value and profit are understated or overstated by however much they've moved. Refreshing prices usually fixes it; a fund needs its ISIN, which the mutual-fund statement (CAS) carries.`,
      account: null,
      stocks: unpriced.map((r) => stock(r.security.id)),
      need: null,
      fix: "refresh_prices",
    });
  const oldest = open.map((r) => r.quote?.asOf).filter((x): x is string => !!x).sort()[0];
  if (oldest && daysBetween(oldest, today) > 3)
    items.push({
      id: "stale_prices",
      kind: "stale_prices",
      severity: "info",
      title: `Some prices are from ${longDate(oldest)}`,
      detail: "Prices refresh on their own every few hours while the app runs. Refresh now to bring them up to date.",
      account: null,
      stocks: [],
      need: null,
      fix: "refresh_prices",
    });
  if (!h.fxComplete)
    items.push({
      id: "fx",
      kind: "fx_missing",
      severity: "high",
      title: `No exchange rate yet for ${h.unconvertibleCurrencies.join(", ")}`,
      detail: `Holdings in ${h.unconvertibleCurrencies.join(", ")} are left out of your totals until a rate is fetched — they're never added as if they were rupees.`,
      account: null,
      stocks: h.holdings.filter((r) => h.unconvertibleCurrencies.includes(r.security.currency) && r.netQty !== "0").map((r) => stock(r.security.id)),
      need: null,
      fix: "refresh_prices",
    });
  const noFx = ledger.filter((t) => t.currency !== base && !t.fxRateToBase && t.securityId && !DERIVED.has(t.sourceBroker ?? ""));
  if (noFx.length)
    items.push({
      id: "fx_at_cost",
      kind: "fx_at_cost",
      severity: "info",
      title: `${plural(noFx.length, "foreign trade")} without the day's exchange rate`,
      detail: "Their rupee cost uses today's rate until the rate on the trade day is fetched, which happens on its own. Refresh to fetch it now.",
      account: null,
      stocks: [...new Set(noFx.map((t) => t.securityId!))].slice(0, 12).map((id) => stock(id)),
      need: null,
      fix: "refresh_prices",
    });

  // Splits from public data: filled in for you, and any that couldn't be confirmed.
  const reviews = (await db.select().from(splitReviews).where(eq(splitReviews.userId, userId)).all()).filter(
    (r) => inPeople(r.portfolioId) && (!scope.brokers?.length || shownAccounts.some((a) => a.id === r.accountKey)),
  );
  const accName = (key: string, pid: string) => shownAccounts.find((a) => a.id === key)?.name ?? `${personOf.get(pid) ?? ""} · entered by hand`;
  const unsure = reviews.filter((r) => r.status === "unconfirmed");
  if (unsure.length)
    items.push({
      id: "split_unconfirmed",
      kind: "split_unconfirmed",
      severity: "warn",
      title: `${plural(unsure.length, "stock split")} couldn't be confirmed`,
      detail: "Public data lists these splits, but your trade prices don't make clear whether your files already count them. Compare the share count with your broker's; if it's off by the split, add the split by hand in Activity.",
      account: null,
      stocks: unsure.map((r) => stock(r.securityId, `${longDate(r.exDate)} · ${accName(r.accountKey, r.portfolioId)} · ${r.detail ?? ""}`)),
      need: null,
      fix: "check_splits",
    });
  const added = reviews.filter((r) => r.status === "added" && ledger.some((t) => t.sourceBroker === SPLIT_SOURCE && t.securityId === r.securityId && day(t.tradeDate) === r.exDate));
  if (added.length)
    items.push({
      id: "split_added",
      kind: "split_added",
      severity: "done",
      title: `${plural(added.length, "stock split")} filled in from public data`,
      detail: "Your files didn't include these, so they were added — each confirmed against your own trade prices. If one is wrong, delete it in Activity and it won't come back.",
      account: null,
      stocks: added.map((r) => {
        const row = ledger.find((t) => t.sourceBroker === SPLIT_SOURCE && t.securityId === r.securityId && day(t.tradeDate) === r.exDate);
        return stock(r.securityId, `${row ? `${d(row.price).toFixed()}-for-1` : "split"} on ${longDate(r.exDate)} · ${accName(r.accountKey, r.portfolioId)}`);
      }),
      need: null,
      fix: null,
    });

  items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { items, baseCurrency: base };
}

export function registerAttentionRoutes(app: FastifyInstance, db: DB): void {
  app.get("/api/attention", authed(app), async (req) => {
    const scope = await scopeFromRequest(db, req.user!.id, req.query);
    return computeAttention(db, req.user!.id, scope);
  });
}
