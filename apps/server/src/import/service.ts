import { randomUUID, createHash } from "node:crypto";
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import type { DB, Database } from "../db/index.js";
import { transactions, importBatches, securities, accounts, quotes } from "../db/schema.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { getPortfolioOwned } from "../domain/portfolios.js";
import { findOrCreateSecurity, reclassifyHeld } from "../domain/securities.js";
import { parseCsv } from "./csv.js";
import { looksLikeXlsx, workbookToCsv } from "./xlsx.js";
import { extractCasText, parseCasTransactions } from "./cas.js";
import { getAdapter, detectBest } from "./registry.js";
import type { GenericMapping } from "./adapters/generic.js";
import type { BrokerAdapter, NormalizedRow, NormalizedTx } from "./types.js";

export interface ImportParams {
  portfolioId: string;
  accountId?: string | null;
  broker: string;
  filename: string;
  content: string;
  /** When "base64", `content` is a base64-encoded upload — an .xlsx workbook, a CAS PDF, or non-UTF8 CSV. */
  encoding?: "base64";
  /** Password for a CAS PDF import (broker "cas") — usually the investor's PAN. */
  casPassword?: string;
  mapping?: GenericMapping;
  /** The period this file covers. When `replace` is set, existing rows from the same source
   *  in this range are deleted first, so re-uploading an overlapping period overwrites cleanly. */
  from?: string;
  to?: string;
  replace?: boolean;
}

export interface RowIssue {
  rowIndex: number;
  error: string;
}

export interface ImportPreview {
  broker: string;
  detected: { broker: string; confidence: number; reason: string } | null;
  rowsTotal: number;
  valid: number;
  invalid: number;
  duplicates: number;
  newSecurities: number;
  toImport: number;
  invalidRows: RowIssue[];
  newSecuritySymbols: string[];
  /** The date span the file covers, read from its transactions (null if it carries no dates). */
  period: { from: string; to: string } | null;
}

/** First and last transaction date in a parsed file — the period it covers. */
function fileDateRange(rows: NormalizedRow[]): { from: string; to: string } | null {
  let min: string | null = null;
  let max: string | null = null;
  for (const r of rows) {
    if (!r.ok) continue;
    const d = r.tx.tradeDate; // ISO-8601, so lexical compare is chronological
    if (min === null || d < min) min = d;
    if (max === null || d > max) max = d;
  }
  return min !== null && max !== null ? { from: min, to: max } : null;
}

const dayStart = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`).toISOString();
const dayEnd = (iso: string) => new Date(`${iso.slice(0, 10)}T23:59:59.999Z`).toISOString();

interface Classified {
  toInsert: { tx: NormalizedTx; rawHash: string }[];
  invalidRows: RowIssue[];
  duplicates: number;
  newSecuritySymbols: Set<string>;
}

function dedupKey(tx: NormalizedTx, rawHash: string): string {
  return tx.externalRef ? `ref:${tx.externalRef}` : `hash:${rawHash}`;
}

async function classify(db: Database, userId: string, rows: NormalizedRow[]): Promise<Classified> {
  const invalidRows: RowIssue[] = [];
  const valid: { tx: NormalizedTx; rawHash: string }[] = [];
  // Disambiguate genuinely-identical rows that lack a broker trade id by their
  // occurrence order within the file. Two real same-price trades stay distinct, while
  // re-uploading the same file reproduces the same hashes → still idempotent.
  const occ = new Map<string, number>();
  for (const r of rows) {
    if (!r.ok) {
      invalidRows.push({ rowIndex: r.rowIndex, error: r.error });
      continue;
    }
    let effHash = r.rawHash;
    if (!r.tx.externalRef) {
      const n = occ.get(r.rawHash) ?? 0;
      occ.set(r.rawHash, n + 1);
      effHash = `${r.rawHash}:${n}`;
    }
    valid.push({ tx: r.tx, rawHash: effHash });
  }

  // Existing dedup keys already in the ledger for this user.
  const refs = valid.map((v) => v.tx.externalRef).filter((x): x is string => !!x);
  const hashes = valid.map((v) => v.rawHash);
  const existingRefs = new Set<string>();
  const existingHashes = new Set<string>();
  if (refs.length) {
    const rows2 = await db
      .select({ externalRef: transactions.externalRef })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.externalRef, refs)))
      .all();
    for (const x of rows2) if (x.externalRef) existingRefs.add(x.externalRef);
  }
  if (hashes.length) {
    const rows3 = await db
      .select({ rawRowHash: transactions.rawRowHash })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.rawRowHash, hashes)))
      .all();
    for (const x of rows3) if (x.rawRowHash) existingHashes.add(x.rawRowHash);
  }

  const seen = new Set<string>();
  const toInsert: { tx: NormalizedTx; rawHash: string }[] = [];
  let duplicates = 0;
  const newSecuritySymbols = new Set<string>();

  // Which securities already exist (by isin or symbol)?
  for (const v of valid) {
    const key = dedupKey(v.tx, v.rawHash);
    const isDbDup =
      (v.tx.externalRef && existingRefs.has(v.tx.externalRef)) || existingHashes.has(v.rawHash);
    if (isDbDup || seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    toInsert.push(v);
    if (v.tx.security) newSecuritySymbols.add(v.tx.security.symbol);
  }

  // Narrow newSecuritySymbols to those NOT already in the master.
  if (newSecuritySymbols.size) {
    const syms = [...newSecuritySymbols];
    const existing = await db
      .select({ symbol: securities.symbol })
      .from(securities)
      .where(inArray(securities.symbol, syms))
      .all();
    for (const e of existing) newSecuritySymbols.delete(e.symbol);
  }

  return { toInsert, invalidRows, duplicates, newSecuritySymbols };
}

/** Resolve the upload to CSV text: a base64 .xlsx becomes the best-matching sheet; base64 text is
 *  decoded; plain text passes through. */
function resolveCsvText(params: ImportParams, adapter: BrokerAdapter): string {
  if (params.encoding !== "base64") return params.content;
  const buf = Buffer.from(params.content, "base64");
  if (looksLikeXlsx(buf, params.filename)) return workbookToCsv(buf, adapter);
  return buf.toString("utf8");
}

function parseWithAdapter(params: ImportParams) {
  if (params.broker === "generic" && !params.mapping)
    throw new BadRequestError("mapping_required", "A column mapping is required for a generic import");
  const adapter = getAdapter(params.broker, params.mapping);
  if (!adapter) throw new BadRequestError("unknown_broker", `No importer for broker '${params.broker}'`);
  const csv = parseCsv(resolveCsvText(params, adapter));
  if (csv.rows.length === 0) throw new BadRequestError("empty_csv", "The file contains no data rows");
  const detected = detectBest(csv);
  const detection = adapter.detect(csv);
  if (detection.confidence === 0)
    throw new BadRequestError("format_unrecognized", `File doesn't look like a ${params.broker} export: ${detection.reason}`);
  return { csv, adapter, detected, rows: adapter.normalize(csv) };
}

type Detected = { broker: string; confidence: number; reason: string } | null;

/** Normalized rows for an import — a Consolidated Account Statement PDF, or a broker file adapter. */
async function resolveRows(params: ImportParams): Promise<{ rows: NormalizedRow[]; detected: Detected }> {
  if (params.broker === "cas") {
    const buf = Buffer.from(params.content, "base64");
    let text: string;
    try {
      text = await extractCasText(buf, params.casPassword);
    } catch (err) {
      if ((err as { code?: string }).code === "cas_password")
        throw new BadRequestError("cas_password", (err as Error).message);
      throw new BadRequestError("cas_unreadable", "Couldn't read this PDF. Please upload the original CAS file.");
    }
    const rows = parseCasTransactions(text);
    if (rows.length === 0)
      throw new BadRequestError("cas_empty", "No mutual-fund transactions were found. Make sure this is a detailed CAS (not a summary).");
    return { rows, detected: { broker: "cas", confidence: 1, reason: "Consolidated Account Statement" } };
  }
  const { rows, detected } = parseWithAdapter(params);
  return { rows, detected };
}

export async function previewImport(db: DB, userId: string, params: ImportParams): Promise<ImportPreview> {
  await getPortfolioOwned(db, userId, params.portfolioId);
  const { rows, detected } = await resolveRows(params);
  const c = await classify(db, userId, rows);
  return {
    broker: params.broker,
    detected,
    rowsTotal: rows.length,
    valid: rows.length - c.invalidRows.length,
    invalid: c.invalidRows.length,
    duplicates: c.duplicates,
    newSecurities: c.newSecuritySymbols.size,
    toImport: c.toInsert.length,
    invalidRows: c.invalidRows.slice(0, 50),
    newSecuritySymbols: [...c.newSecuritySymbols].slice(0, 100),
    period: fileDateRange(rows),
  };
}

export interface ImportResult extends ImportPreview {
  batchId: string;
  imported: number;
  replaced: number;
}

export async function commitImport(db: DB, userId: string, params: ImportParams): Promise<ImportResult> {
  await getPortfolioOwned(db, userId, params.portfolioId);
  if (params.accountId) {
    const acc = await db
      .select({ id: accounts.id, portfolioId: accounts.portfolioId })
      .from(accounts)
      .where(and(eq(accounts.id, params.accountId), eq(accounts.userId, userId)))
      .get();
    if (!acc) throw new NotFoundError("Account");
    if (acc.portfolioId !== params.portfolioId)
      throw new BadRequestError("account_portfolio_mismatch", "Account does not belong to that portfolio");
  }

  const { rows, detected } = await resolveRows(params);

  // The period the file covers, read from its own transaction dates (an explicit from/to may
  // still override it for headless callers). Used by replace mode to clear the overlapping range.
  const period = params.from && params.to ? { from: params.from, to: params.to } : fileDateRange(rows);
  const fileHash = createHash("sha256").update(params.content).digest("hex");
  const batchId = randomUUID();

  // One atomic transaction for the whole write: if anything fails (e.g. a UNIQUE clash on an
  // external ref), it all rolls back — never a half-applied import, and never a replace-delete
  // left with nothing put back in its place.
  const { c, imported, replaced } = await db.transaction(async (trx) => {
    // Overwrite mode: clear existing rows from this source over the file's period, so re-uploading
    // an overlapping range (e.g. a full-year file over monthly ones) doesn't duplicate. Deleting
    // before classify means the new rows aren't treated as duplicates of the ones they replace.
    let replaced = 0;
    if (params.replace && period) {
      const res = await trx
        .delete(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.portfolioId, params.portfolioId),
            eq(transactions.sourceBroker, params.broker),
            gte(transactions.tradeDate, dayStart(period.from)),
            lte(transactions.tradeDate, dayEnd(period.to)),
          ),
        )
        .run();
      replaced = res.rowsAffected ?? 0;
    }

    const c = await classify(trx, userId, rows);

    await trx
      .insert(importBatches)
      .values({
        id: batchId,
        userId,
        portfolioId: params.portfolioId,
        accountId: params.accountId ?? null,
        broker: params.broker,
        filename: params.filename,
        fileHash,
        status: "committed",
        rowsTotal: rows.length,
        rowsImported: c.toInsert.length,
        rowsSkipped: c.duplicates,
        rowsInvalid: c.invalidRows.length,
      })
      .run();

    // Resolve each DISTINCT security once (a file usually has many trades per security), then
    // bulk-insert the transactions and any seeded quotes in chunks — far fewer statements than a
    // find-or-create + insert per row. Securities are created eagerly so the FK is satisfied.
    const secByIdentity = new Map<string, string>();
    const identityOf = (s: NonNullable<NormalizedTx["security"]>) =>
      s.isin ? `i:${s.isin}` : s.exchange ? `s:${s.symbol}|${s.exchange}` : `s:${s.symbol}`;
    const resolveSecurityId = async (s: NonNullable<NormalizedTx["security"]>, currency: string): Promise<string> => {
      const key = identityOf(s);
      const cached = secByIdentity.get(key);
      if (cached) return cached;
      const { security } = await findOrCreateSecurity(trx, {
        symbol: s.symbol,
        name: s.name ?? s.symbol,
        isin: s.isin,
        assetClass: s.assetClass,
        exchange: s.exchange,
        sector: s.sector,
        subSector: s.subSector,
        currency,
      });
      secByIdentity.set(key, security.id);
      return security.id;
    };

    const txRows: (typeof transactions.$inferInsert)[] = [];
    const quoteRows: (typeof quotes.$inferInsert)[] = [];
    for (const { tx, rawHash } of c.toInsert) {
      const securityId = tx.security ? await resolveSecurityId(tx.security, tx.currency) : null;
      txRows.push({
        id: randomUUID(),
        userId,
        portfolioId: params.portfolioId,
        accountId: params.accountId ?? null,
        securityId,
        importBatchId: batchId,
        type: tx.type,
        tradeDate: tx.tradeDate,
        quantity: tx.quantity,
        price: tx.price,
        grossAmount: tx.grossAmount,
        fees: tx.fees,
        taxes: tx.taxes,
        currency: tx.currency,
        segment: tx.segment,
        externalRef: tx.externalRef ?? null,
        rawRowHash: rawHash,
        sourceBroker: params.broker,
      });
      // A holdings snapshot carries a current price → seed a quote so value shows without a refresh.
      if (tx.quotePrice && securityId) {
        quoteRows.push({ id: randomUUID(), securityId, price: tx.quotePrice, prevClose: null, currency: tx.currency, asOf: new Date().toISOString(), provider: "import" });
      }
    }
    const CHUNK = 100; // keep well under SQLite's bound-variable limit
    for (let i = 0; i < txRows.length; i += CHUNK) await trx.insert(transactions).values(txRows.slice(i, i + CHUNK)).run();
    for (let i = 0; i < quoteRows.length; i += CHUNK) await trx.insert(quotes).values(quoteRows.slice(i, i + CHUNK)).run();

    return { c, imported: txRows.length, replaced };
  });

  // Auto-classify newly imported securities (sectors, sub-sectors, asset class) — best effort, and
  // OUTSIDE the import transaction so a classification hiccup can never roll back a good import.
  if (imported > 0) {
    try {
      await reclassifyHeld(db, userId);
    } catch {
      /* cosmetic enrichment only */
    }
  }

  return {
    batchId,
    imported,
    replaced,
    broker: params.broker,
    detected,
    rowsTotal: rows.length,
    valid: rows.length - c.invalidRows.length,
    invalid: c.invalidRows.length,
    duplicates: c.duplicates,
    newSecurities: c.newSecuritySymbols.size,
    toImport: c.toInsert.length,
    invalidRows: c.invalidRows.slice(0, 50),
    newSecuritySymbols: [...c.newSecuritySymbols].slice(0, 100),
    period: fileDateRange(rows),
  };
}

export async function getBatch(db: DB, userId: string, id: string) {
  const row = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.id, id), eq(importBatches.userId, userId)))
    .get();
  if (!row) throw new NotFoundError("Import batch");
  return row;
}
