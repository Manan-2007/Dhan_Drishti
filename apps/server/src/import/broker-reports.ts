import * as XLSX from "xlsx";
import { d, ZERO, type Decimal } from "@dhan-drishti/core";
import { rowHash } from "./csv.js";
import { canonicalDate, IST } from "./dates.js";
import type { NormalizedRow } from "./types.js";
import type { PnlReport, PnlReportRow } from "./pnl-report.js";

/**
 * Brokers' own profit reports that come as multi-sheet workbooks with sectioned tables — not one
 * clean table — so they need reading sheet by sheet:
 *
 *  - Zerodha **tax P&L** ("taxpnl-<ID>-<FY>.xlsx"): tradewise exits per section (intraday, short
 *    term, long term, debt ETF, F&O…), plus a Dividends & Interest sheet that the tradebook never
 *    carries.
 *  - Zerodha **P&L statement** ("pnl-<ID>.xlsx"): one row per symbol with buy and sell values.
 *  - Vested **Profit-Loss Statement**: realised and unrealised P&L, summary and per-lot, in USD.
 *
 * Every figure is the broker's; they cross-check the ledger and are never added on top of trades.
 * Dividends are the exception — they're income the trade files don't record.
 */

export type BrokerReportFormat = "zerodha-taxpnl" | "zerodha-pnl" | "vested-pnl";

type Cell = string | number | null | undefined;
type Matrix = Cell[][];

const matrixOf = (wb: XLSX.WorkBook, name: string): Matrix => {
  const ws = wb.Sheets[name];
  return ws ? (XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, blankrows: false, defval: "" }) as Matrix) : [];
};
const text = (c: Cell) => String(c ?? "").trim();
const lower = (c: Cell) => text(c).toLowerCase();
const num = (c: Cell): Decimal | null => {
  const s = text(c).replace(/[,₹$\s"]/g, "");
  return s !== "" && Number.isFinite(Number(s)) ? d(s) : null;
};
/** Cells that actually hold something. */
const filled = (row: Cell[]) => row.filter((c) => text(c) !== "");
const findSheet = (wb: XLSX.WorkBook, re: RegExp) => wb.SheetNames.find((n) => re.test(n.trim()));
/** "… from 2025-04-01 to 2026-03-31" anywhere in the first rows of a sheet. */
const ISO_PERIOD = /(\d{4}-\d{2}-\d{2})\s*(?:to|-|–)\s*(\d{4}-\d{2}-\d{2})/;
function periodIn(m: Matrix): { from: string; to: string } | null {
  for (const row of m.slice(0, 12)) {
    for (const c of row) {
      const p = ISO_PERIOD.exec(text(c));
      if (p) return { from: p[1]!, to: p[2]! };
    }
  }
  return null;
}

/** Which of the known report layouts a workbook is, if any. */
export function identifyBrokerReport(wb: XLSX.WorkBook): BrokerReportFormat | null {
  if (findSheet(wb, /^tradewise exits/i)) return "zerodha-taxpnl";
  if (findSheet(wb, /^realized p&l\s*-\s*summary$/i) && findSheet(wb, /^user details$/i)) return "vested-pnl";
  for (const name of wb.SheetNames) {
    const top = matrixOf(wb, name).slice(0, 4);
    if (top.some((r) => /^p&l statement for /i.test(text(r[0]))) && top.some((r) => lower(r[0]) === "client id")) return "zerodha-pnl";
  }
  return null;
}

/** Sum rows of the same instrument (a report lists one row per exit lot). */
function aggregate(rows: (PnlReportRow & { profit: Decimal | null })[]): { rows: PnlReportRow[]; net: Decimal | null } {
  const by = new Map<string, PnlReportRow & { profit: Decimal | null }>();
  let net: Decimal | null = null;
  for (const r of rows) {
    const k = r.name.toUpperCase();
    const had = by.get(k);
    if (had) {
      had.quantity = had.quantity.plus(r.quantity);
      had.buyValue = had.buyValue.plus(r.buyValue);
      had.sellValue = had.sellValue.plus(r.sellValue);
    } else by.set(k, { ...r });
    const p = r.profit ?? r.sellValue.minus(r.buyValue);
    net = (net ?? ZERO).plus(p);
  }
  return { rows: [...by.values()].map(({ profit: _p, ...rest }) => rest), net };
}

/**
 * Walk a sectioned sheet: a one-cell title row, then a header row, then data rows, repeated.
 * Calls `onRow` with the current header's column lookup for every data row.
 */
function walkSections(m: Matrix, isHeader: (row: Cell[]) => boolean, onRow: (row: Cell[], col: (names: string[]) => number, section: string) => void) {
  let header: string[] | null = null;
  let section = "";
  for (const row of m) {
    const cells = filled(row);
    if (cells.length === 0) continue;
    if (cells.length === 1 && header === null) {
      section = text(cells[0]);
      continue;
    }
    if (isHeader(row)) {
      header = row.map(lower);
      continue;
    }
    if (cells.length === 1) {
      // A section title or a footnote ends the current table.
      section = text(cells[0]);
      header = null;
      continue;
    }
    if (!header) continue;
    const h = header;
    onRow(row, (names) => h.findIndex((x) => names.includes(x)), section);
  }
}

// ---- Zerodha tax P&L ---------------------------------------------------------------------------

export function parseZerodhaTaxPnl(wb: XLSX.WorkBook): PnlReport {
  const exitsName = findSheet(wb, /^tradewise exits/i)!;
  const exits = matrixOf(wb, exitsName);
  const period = periodIn(exits);

  const lots: (PnlReportRow & { profit: Decimal | null })[] = [];
  walkSections(
    exits,
    (row) => lower(row[0]) === "symbol",
    (row, col) => {
      const name = text(row[col(["symbol"])]);
      const quantity = num(row[col(["quantity"])]);
      const buyValue = num(row[col(["buy value"])]);
      const sellValue = num(row[col(["sell value"])]);
      if (!name || !quantity?.gt(0) || !buyValue || buyValue.lt(0) || !sellValue || sellValue.lt(0)) return;
      const pi = col(["profit", "realized p&l", "realised p&l"]);
      lots.push({ name, quantity, buyValue, sellValue, profit: pi >= 0 ? num(row[pi]) : null, line: row.map(text).join(",") });
    },
  );
  const { rows, net } = aggregate(lots);

  return {
    from: period?.from ?? null,
    to: period?.to ?? null,
    rows,
    netPnl: rows.length ? net : null,
    currency: "INR",
    dividends: zerodhaDividends(wb),
  };
}

/** The Dividends & Interest sheet → income rows (deduped by symbol, date and amount). */
function zerodhaDividends(wb: XLSX.WorkBook): NormalizedRow[] {
  const name = findSheet(wb, /^dividends\s*&\s*interest$/i);
  if (!name) return [];
  const out: NormalizedRow[] = [];
  walkSections(
    matrixOf(wb, name),
    (row) => lower(row[0]) === "symbol",
    (row, col) => {
      const symbol = text(row[col(["symbol"])]).toUpperCase();
      const isin = text(row[col(["isin"])]) || undefined;
      const dateCol = col(["ex-date", "record date"]);
      const amountCol = col(["net dividend amount", "net interest amount"]);
      const isInterest = col(["net interest amount"]) >= 0;
      const tradeDate = canonicalDate(text(row[dateCol]), IST);
      const amount = num(row[amountCol]);
      const i = out.length;
      if (!symbol || !tradeDate || !amount?.gt(0)) return;
      out.push({
        ok: true,
        rowIndex: i,
        rawHash: rowHash("zerodha-taxpnl", `${isInterest ? "int" : "div"}|${symbol}|${tradeDate.slice(0, 10)}|${amount.toFixed()}`),
        tx: {
          security: { symbol, isin, assetClass: "equity", exchange: "NSE" },
          type: isInterest ? "interest" : "dividend",
          tradeDate,
          quantity: "0",
          price: "0",
          grossAmount: amount.toFixed(),
          fees: "0",
          taxes: "0",
          currency: "INR",
          segment: "equity",
        },
      });
    },
  );
  return out;
}

// ---- Zerodha P&L statement ---------------------------------------------------------------------

export function parseZerodhaPnl(wb: XLSX.WorkBook): PnlReport {
  const name = wb.SheetNames.find((n) => matrixOf(wb, n).slice(0, 4).some((r) => /^p&l statement for /i.test(text(r[0])))) ?? wb.SheetNames[0]!;
  const m = matrixOf(wb, name);
  const period = periodIn(m);
  // "Realized P&L, 797.78" in the summary block is the broker's bottom line (before charges).
  const summary = m.find((r) => /^reali[sz]ed p&l$/i.test(text(r[0])) && num(r[1]) !== null);
  const lots: (PnlReportRow & { profit: Decimal | null })[] = [];
  walkSections(
    m,
    (row) => lower(row[0]) === "symbol",
    (row, col) => {
      const sym = text(row[col(["symbol"])]);
      const quantity = num(row[col(["quantity"])]);
      const buyValue = num(row[col(["buy value"])]);
      const sellValue = num(row[col(["sell value"])]);
      if (!sym || !quantity?.gt(0) || !buyValue || !sellValue) return;
      const pi = col(["realized p&l", "realised p&l"]);
      lots.push({ name: sym, quantity, buyValue, sellValue, profit: pi >= 0 ? num(row[pi]) : null, line: row.map(text).join(",") });
    },
  );
  const { rows, net } = aggregate(lots);
  return { from: period?.from ?? null, to: period?.to ?? null, rows, netPnl: summary ? num(summary[1]) : rows.length ? net : null, currency: "INR" };
}

// ---- Vested Profit-Loss Statement --------------------------------------------------------------

export function parseVestedPnl(wb: XLSX.WorkBook): PnlReport {
  const details = matrixOf(wb, findSheet(wb, /^user details$/i)!);
  const head = (details[0] ?? []).map(lower);
  const vals = details[1] ?? [];
  const periodCell = text(vals[head.indexOf("period")]);
  const p = ISO_PERIOD.exec(periodCell);

  const m = matrixOf(wb, findSheet(wb, /^realized p&l\s*-\s*summary$/i)!);
  const lots: (PnlReportRow & { profit: Decimal | null })[] = [];
  walkSections(
    m,
    (row) => lower(row[0]) === "security",
    (row, col) => {
      const name = text(row[col(["security"])]);
      const quantity = num(row[col(["quantity"])]);
      const sellValue = num(row[col(["proceeds (usd)", "proceeds"])]);
      const buyValue = num(row[col(["cost basis (usd)", "cost basis"])]);
      if (!name || !quantity?.gt(0) || !buyValue || !sellValue) return;
      const pi = col(["profit/loss (usd)", "profit/loss"]);
      lots.push({ name, quantity, buyValue, sellValue, profit: pi >= 0 ? num(row[pi]) : null, line: row.map(text).join(",") });
    },
  );
  const { rows, net } = aggregate(lots);
  return { from: p?.[1] ?? null, to: p?.[2] ?? null, rows, netPnl: rows.length ? net : null, currency: "USD" };
}

export function parseBrokerReport(wb: XLSX.WorkBook, format: BrokerReportFormat): PnlReport {
  if (format === "zerodha-taxpnl") return parseZerodhaTaxPnl(wb);
  if (format === "vested-pnl") return parseVestedPnl(wb);
  return parseZerodhaPnl(wb);
}

/** Broker, account number and holder name a report carries (column- or key/value-style). */
export function reportIdentity(wb: XLSX.WorkBook, format: BrokerReportFormat): { brokerFamily: string; accountRef: string | null; holderName: string | null } {
  if (format === "vested-pnl") {
    const details = matrixOf(wb, findSheet(wb, /^user details$/i)!);
    const head = (details[0] ?? []).map(lower);
    const vals = details[1] ?? [];
    const at = (keys: string[]) => {
      const i = head.findIndex((h) => keys.includes(h));
      return i >= 0 ? text(vals[i]) || null : null;
    };
    const ref = at(["drivewealth acc no", "drivewealth account number", "account number", "account no"]);
    return { brokerFamily: "vested", accountRef: ref ? ref.toUpperCase() : null, holderName: at(["name"]) };
  }
  let accountRef: string | null = null;
  let holderName: string | null = null;
  for (const name of wb.SheetNames) {
    for (const row of matrixOf(wb, name).slice(0, 6)) {
      if (!accountRef && lower(row[0]) === "client id" && text(row[1])) accountRef = text(row[1]).toUpperCase();
      if (!holderName && lower(row[0]) === "client name" && text(row[1])) holderName = text(row[1]);
    }
    if (accountRef && holderName) break;
  }
  return { brokerFamily: "zerodha", accountRef, holderName };
}
