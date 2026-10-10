import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { and, eq } from "drizzle-orm";
import { computeHoldings, d, Decimal, ZERO, fifoCapitalGains, realisedEvents, type CanonicalTx } from "@dhan-drishti/core";
import type { Database } from "../db/index.js";
import { securities, transactions } from "../db/schema.js";
import { parseDerivativeSymbol } from "../market/derivative-symbol.js";
import { parseCsv, pick, rowHash } from "./csv.js";
import { EXPIRY_SOURCE } from "./expiry.js";
import { identifyBrokerReport, parseBrokerReport } from "./broker-reports.js";
import { looksLikeXlsx, workbookToCsv } from "./xlsx.js";
import type { NormalizedRow } from "./types.js";

/**
 * A broker's realised-P&L report (Dhan's "Realised PnL Report": one row per instrument closed in
 * the period, with the quantity and the buy and sell values behind it) used as a cross-check.
 *
 * Brokers' transaction statements sometimes leave out a closing trade — Dhan's drops some F&O exits —
 * so the contract looks open forever and its profit never shows. The P&L report still counts the
 * exit. Where the report and the ledger disagree by EXACTLY the still-open quantity, the missing
 * trade is added, priced from the report. Anything less clear-cut is left alone and counted.
 */

export interface PnlReportRow {
  name: string;
  quantity: Decimal;
  buyValue: Decimal;
  sellValue: Decimal;
  line: string;
}

export interface PnlReport {
  /** Period the report covers (YYYY-MM-DD), from its title line or its file name. */
  from: string | null;
  to: string | null;
  rows: PnlReportRow[];
  /** The broker's own bottom line, after charges. */
  netPnl: Decimal | null;
  /** Currency the report's figures are in (Vested reports in USD). */
  currency?: string;
  /** Income the report carries that trade files don't (Zerodha tax P&L dividends & interest). */
  dividends?: NormalizedRow[];
}

const NAME = ["scrip name", "security name", "instrument", "contract", "name", "symbol"];
const QTY = ["quantity", "qty"];
const BUY_VALUE = ["buy value"];
const SELL_VALUE = ["sell value"];

const num = (raw: string | undefined): Decimal | null => {
  const s = (raw ?? "").replace(/[,₹\s"]/g, "");
  return s !== "" && Number.isFinite(Number(s)) ? d(s) : null;
};

const PERIOD = /(\d{2})-(\d{2})-(\d{4})\D+?(\d{2})-(\d{2})-(\d{4})/;
const ISO_PERIOD = /(\d{4}-\d{2}-\d{2})\D+?(\d{4}-\d{2}-\d{2})/;

export function parsePnlReport(text: string, filename = ""): PnlReport {
  const clean = text.replace(/^﻿/, "");
  const head = clean.split(/\r?\n/, 3).join(" ");
  const p = PERIOD.exec(/from/i.test(head) ? head : filename) ?? PERIOD.exec(filename);
  const iso = (dd: string, mm: string, yyyy: string) => `${yyyy}-${mm}-${dd}`;
  const isoP = p ? null : ISO_PERIOD.exec(/from/i.test(head) ? head : filename);

  const csv = parseCsv(clean);
  const rows: PnlReportRow[] = [];
  csv.rows.forEach((raw, i) => {
    const name = pick(raw, NAME);
    const quantity = num(pick(raw, QTY));
    const buyValue = num(pick(raw, BUY_VALUE));
    const sellValue = num(pick(raw, SELL_VALUE));
    // Footer lines ("Net P&L,-4857.27,Brokerage,…", "NOTE : …") land in the table too.
    if (!name || /^(net|gross) p&l|^total|^note\b/i.test(name)) return;
    if (!quantity?.gt(0) || !buyValue || buyValue.lt(0) || !sellValue || sellValue.lt(0)) return;
    rows.push({ name, quantity, buyValue, sellValue, line: csv.rawLines[i] ?? name });
  });

  const net = /^\s*"?Net P&L"?\s*,\s*"?(-?[\d.,]+)/im.exec(clean) ?? /^\s*"?Reali[sz]ed P&L"?\s*,\s*"?(-?[\d.,]+)/im.exec(clean);
  return {
    from: p ? iso(p[1]!, p[2]!, p[3]!) : (isoP?.[1] ?? null),
    to: p ? iso(p[4]!, p[5]!, p[6]!) : (isoP?.[2] ?? null),
    rows,
    netPnl: net ? num(net[1]) : null,
    currency: "INR",
  };
}

/**
 * Read a P&L report from an upload: the multi-sheet broker workbooks (Zerodha tax P&L and P&L
 * statement, Vested's Profit-Loss Statement) sheet by sheet, anything else as one table.
 */
export function parsePnlFile(file: { filename: string; content: string; encoding?: "base64" }): PnlReport {
  if (file.encoding === "base64") {
    const buf = Buffer.from(file.content, "base64");
    if (looksLikeXlsx(buf, file.filename)) {
      const wb = XLSX.read(buf, { type: "buffer" });
      const format = identifyBrokerReport(wb);
      if (format) return parseBrokerReport(wb, format);
      return parsePnlReport(workbookToCsv(buf), file.filename);
    }
    return parsePnlReport(buf.toString("utf8"), file.filename);
  }
  return parsePnlReport(file.content, file.filename);
}

export interface FilledTrade {
  contract: string;
  type: "buy" | "sell";
  quantity: string;
  price: string;
  tradeDate: string;
}

export interface PnlCheck {
  /** The broker's net P&L for the period, and ours for the same instruments and period. */
  broker: string;
  ours: string;
  difference: string;
  from: string;
  to: string;
  /**
   * Shares this account sold without a matching purchase in the ledger — bought before the files
   * start. The broker knows their cost; we don't, so the two totals can't agree until an older
   * statement is added.
   */
  soldWithoutPurchase: number;
  /** Currency both figures are in. */
  currency: string;
}

export interface ReconcileResult {
  filled: FilledTrade[];
  /** Contracts that expired within the report yet are still open here, and didn't match exactly. */
  unmatched: number;
  check: PnlCheck | null;
}

const upper = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
/** "Nippon Nifty Bank ETF (BANKBEES)" → "BANKBEES". */
const tickerIn = (name: string) => /\(([A-Z0-9&.-]{2,})\)\s*$/i.exec(name)?.[1]?.toUpperCase() ?? null;
const sameName = (s: { symbol: string; name: string }, reportName: string) => {
  const n = upper(reportName);
  return upper(s.name) === n || upper(s.symbol) === n || upper(s.symbol) === tickerIn(reportName);
};
/**
 * The same F&O contract under a different label. Dhan's statement and its P&L report can disagree
 * on an MCX expiry by a day ("FUT GOLDM 02 Apr 2026" vs "03 Apr 2026"); same underlying, type and
 * strike with expiries 3 days apart at most is the same contract (weeklies are 7 days apart).
 */
const sameContract = (s: { symbol: string; name: string }, reportName: string) => {
  const x = parseDerivativeSymbol(s.symbol, s.name);
  const y = parseDerivativeSymbol(upper(reportName));
  if (!x || !y || x.kind !== y.kind || x.underlying !== y.underlying) return false;
  if (x.kind === "option" && y.kind === "option" && (x.strike !== y.strike || x.optionType !== y.optionType)) return false;
  return Math.abs(Date.parse(x.expiryISO) - Date.parse(y.expiryISO)) <= 3 * 86_400_000;
};
const sameInstrument = (s: { symbol: string; name: string }, reportName: string) => sameName(s, reportName) || sameContract(s, reportName);
const day = (iso: string) => iso.slice(0, 10);
/** Report values are rounded to the paisa; allow ₹1 or 0.05%, whichever is larger. */
const same = (a: Decimal, b: Decimal) => a.minus(b).abs().lte(Decimal.max(1, b.abs().times(0.0005)));

/** Cross-check one account against a P&L report, adding closing trades the statement left out. */
export async function reconcileWithPnlReport(
  trx: Database,
  userId: string,
  target: { accountId: string; portfolioId: string },
  report: PnlReport,
  source: { broker: string; filename: string },
): Promise<ReconcileResult> {
  const rows = await trx
    .select({ tx: transactions, symbol: securities.symbol, name: securities.name })
    .from(transactions)
    .innerJoin(securities, eq(transactions.securityId, securities.id))
    .where(and(eq(transactions.userId, userId), eq(transactions.accountId, target.accountId)))
    .all();

  const bySecurity = new Map<string, { symbol: string; name: string; txs: (typeof rows)[number]["tx"][] }>();
  // Estimated expiry settlements give way to the broker's own figures (they re-derive afterwards).
  for (const r of rows.filter((x) => x.tx.sourceBroker !== EXPIRY_SOURCE)) {
    const s = bySecurity.get(r.tx.securityId!) ?? { symbol: r.symbol, name: r.name, txs: [] };
    s.txs.push(r.tx);
    bySecurity.set(r.tx.securityId!, s);
  }
  /** An exact name first; else a contract match, but only if it's unambiguous. */
  const findSecurity = (name: string) => {
    for (const [id, s] of bySecurity) if (sameName(s, name)) return { id, ...s };
    const near = [...bySecurity].filter(([, s]) => sameContract(s, name));
    return near.length === 1 ? { id: near[0]![0], ...near[0]![1] } : null;
  };
  const inPeriod = (iso: string) => (!report.from || day(iso) >= report.from) && (!report.to || day(iso) <= report.to);

  const filled: FilledTrade[] = [];
  let unmatched = 0;
  for (const row of report.rows) {
    // Only derivatives: a contract has to end closed, so a leftover quantity is unambiguous. A share
    // position left open is usually just still held.
    const contract = parseDerivativeSymbol(upper(row.name));
    if (!contract) continue;
    const sec = findSecurity(row.name);
    if (!sec) continue;

    const trades = sec.txs.filter((t) => t.type === "buy" || t.type === "sell");
    let net = ZERO;
    for (const t of trades) net = t.type === "buy" ? net.plus(t.quantity) : net.minus(t.quantity);
    if (net.isZero()) continue;

    let bq = ZERO, bv = ZERO, sq = ZERO, sv = ZERO;
    for (const t of trades.filter((x) => inPeriod(x.tradeDate))) {
      if (t.type === "buy") [bq, bv] = [bq.plus(t.quantity), bv.plus(t.grossAmount)];
      else [sq, sv] = [sq.plus(t.quantity), sv.plus(t.grossAmount)];
    }

    // Long left open → the report must show every buy closed, and exactly the leftover more sold.
    // Short left open → the mirror image.
    const missing = net.abs();
    const long = net.gt(0);
    const ok = long
      ? row.quantity.eq(bq) && row.quantity.minus(sq).eq(missing) && same(row.buyValue, bv)
      : row.quantity.eq(sq) && row.quantity.minus(bq).eq(missing) && same(row.sellValue, sv);
    const value = long ? row.sellValue.minus(sv) : row.buyValue.minus(bv);
    if (!ok || value.lt(0)) {
      // A contract still alive when the report ends can rightly be open; only an expired one is a gap.
      if (!report.to || contract.expiryISO.slice(0, 10) <= report.to) unmatched++;
      continue;
    }

    // Dated at expiry (when the contract closed at the latest), never before its last known trade
    // and never past the report's end.
    const last = trades.reduce((m, t) => (day(t.tradeDate) > m ? day(t.tradeDate) : m), "");
    let when = contract.expiryISO.slice(0, 10);
    if (report.to && when > report.to) when = report.to;
    if (when < last) when = last;
    const tradeDate = `${when}T00:00:00.000Z`;
    const type = long ? "sell" : "buy";
    const price = value.div(missing);
    const hash = rowHash(`${source.broker}-pnl-fill`, `${target.accountId}|${upper(row.name)}|${type}|${missing.toFixed()}|${value.toFixed()}`);

    await trx
      .insert(transactions)
      .values({
        id: randomUUID(),
        userId,
        portfolioId: target.portfolioId,
        accountId: target.accountId,
        securityId: sec.id,
        type,
        tradeDate,
        quantity: missing.toFixed(),
        price: price.toFixed(),
        grossAmount: value.toFixed(),
        currency: trades[0]!.currency,
        segment: trades[0]!.segment,
        rawRowHash: hash,
        sourceBroker: `${source.broker}-pnl`,
        notes: `Closing trade missing from the broker's statement, filled from its P&L report (${source.filename}).`,
      })
      .run();
    // Keep the in-memory ledger current so the check below sees the fill.
    sec.txs.push({ ...trades[0]!, id: hash, type, tradeDate, quantity: missing.toFixed(), price: price.toFixed(), grossAmount: value.toFixed(), fees: "0", taxes: "0", externalRef: null, rawRowHash: hash });
    filled.push({ contract: row.name, type, quantity: missing.toFixed(), price: price.toDecimalPlaces(2).toFixed(2), tradeDate });
  }

  return { filled, unmatched, check: checkAgainst(report, bySecurity) };
}

/** Our realised P&L for the instruments the report lists, over its period, next to the broker's. */
function checkAgainst(report: PnlReport, bySecurity: Map<string, { symbol: string; name: string; txs: (typeof transactions.$inferSelect)[] }>): PnlCheck | null {
  if (!report.netPnl || !report.from || !report.to) return null;
  // A report covers one scope (Dhan: all NSE, or F&O only, or commodities), so compare like for like.
  const listed = new Set([...bySecurity].filter(([, s]) => report.rows.some((r) => sameInstrument(s, r.name))).map(([id]) => id));
  if (listed.size === 0) return null;
  const txs = [...bySecurity].filter(([id]) => listed.has(id)).flatMap(([, s]) => s.txs) as unknown as CanonicalTx[];
  const inPeriod = (date: string) => day(date) >= report.from! && day(date) <= report.to!;
  // Brokers book realised gains lot by lot, first in first out (Zerodha's tax P&L, Vested's lots),
  // so shares are compared FIFO. Lots bought before the files start have no known cost and are
  // left out (counted in soldWithoutPurchase instead). F&O, which FIFO doesn't cover, by average.
  const shares = txs.filter((t) => t.segment !== "fno");
  const fno = txs.filter((t) => t.segment === "fno");
  const fifo = fifoCapitalGains(shares, { longTermDays: () => 365 })
    .filter((r) => r.buyDateKnown && inPeriod(r.sellDate))
    .reduce((sum, r) => sum.plus(r.gain), ZERO);
  const avg = realisedEvents(fno)
    .filter((e) => inPeriod(e.date))
    .reduce((sum, e) => sum.plus(e.realised), ZERO);
  const ours = fifo.plus(avg);
  const soldWithoutPurchase = computeHoldings(txs.filter((t) => t.segment === "equity" || t.segment === "mf"), {}).filter((h) => h.hasOversell).length;
  return {
    broker: report.netPnl.toFixed(2),
    ours: ours.toFixed(2),
    difference: ours.minus(report.netPnl).toFixed(2),
    from: report.from,
    to: report.to,
    soldWithoutPurchase,
    currency: report.currency ?? "INR",
  };
}
