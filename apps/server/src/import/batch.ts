import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB, Database } from "../db/index.js";
import { accounts, portfolios } from "../db/schema.js";
import { AppError, BadRequestError, NotFoundError } from "../lib/errors.js";
import { BROKERS } from "../domain/accounts.js";
import { reclassifyHeld } from "../domain/securities.js";
import { computePortfolioHoldings } from "../domain/holdings.js";
import { bumpHoldings } from "../domain/holdings-cache.js";
import { sniffFile, type FileSniff } from "./detect.js";
import { commitRowsInto, countRows, resolveRows, type ImportParams } from "./service.js";
import { parseHoldingPrices, seedPricesFromHoldings, type SeedPricesResult } from "./seed-prices.js";
import { parsePnlReport, reconcileWithPnlReport, type PnlReport, type ReconcileResult } from "./pnl-report.js";
import { looksLikeXlsx, workbookToCsv } from "./xlsx.js";
import type { NormalizedRow } from "./types.js";
import { getAdapter } from "./registry.js";
import { sameAsLatestSnapshot, type SnapshotSummary } from "./snapshot.js";

/**
 * "Drop anything" import: identify each file with no hints, suggest whose account it is, then
 * commit a whole drop — several files, new accounts included — in ONE database transaction.
 */

export interface UploadFile {
  filename: string;
  content: string;
  encoding?: "base64";
  casPassword?: string;
}

export interface AccountSuggestion {
  accountId: string;
  accountName: string;
  portfolioId: string;
  portfolioName: string;
  why: string;
  /** Set when the account has no client code yet: importing records this one on it. */
  adoptRef: string | null;
}

export interface UploadDetection extends FileSniff {
  filename: string;
  /** A holdings statement: checked against the account's trades, never added on top of them. */
  snapshot: boolean;
  counts: Awaited<ReturnType<typeof countRows>> | null;
  priceRows: number | null;
  currency: string | null;
  suggestion: AccountSuggestion | null;
  error: string | null;
}

const upper = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

function mainCurrency(rows: NormalizedRow[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.ok) counts.set(r.tx.currency, (counts.get(r.tx.currency) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [c, k] of counts) if (k > n) [best, n] = [c, k];
  return best;
}

function textOf(file: UploadFile): string {
  if (file.encoding !== "base64") return file.content;
  const buf = Buffer.from(file.content, "base64");
  return looksLikeXlsx(buf, file.filename) ? workbookToCsv(buf) : buf.toString("utf8");
}

/** Match a file to an existing account: by client code first, else the user's only account at that broker. */
async function suggestAccount(db: Database, userId: string, sniff: FileSniff): Promise<AccountSuggestion | null> {
  const rows = await db
    .select({ a: accounts, p: portfolios })
    .from(accounts)
    .innerJoin(portfolios, eq(accounts.portfolioId, portfolios.id))
    .where(eq(accounts.userId, userId))
    .all();
  const toSuggestion = (r: (typeof rows)[number], why: string, adoptRef: string | null = null): AccountSuggestion => ({
    accountId: r.a.id,
    accountName: r.a.name,
    portfolioId: r.p.id,
    portfolioName: r.p.name,
    why,
    adoptRef,
  });
  const atBroker = sniff.brokerFamily ? rows.filter((r) => r.a.broker === sniff.brokerFamily) : [];
  if (sniff.accountRef) {
    const byRef = rows.filter((r) => upper(r.a.accountRef) === upper(sniff.accountRef) && (!sniff.brokerFamily || r.a.broker === sniff.brokerFamily));
    if (byRef.length === 1) return toSuggestion(byRef[0]!, `Client code ${sniff.accountRef}`);
    // A code we haven't seen. If there is exactly one account at this broker and it has no code
    // yet (e.g. set up before codes were read), it's that one — and it learns the code.
    const uncoded = atBroker.filter((r) => !r.a.accountRef);
    if (byRef.length === 0 && atBroker.length === 1 && uncoded.length === 1) {
      return toSuggestion(uncoded[0]!, `Your only ${sniff.brokerFamily} account`, upper(sniff.accountRef));
    }
    return null; // otherwise ask once, then remember it
  }
  if (atBroker.length === 1) return toSuggestion(atBroker[0]!, `Your only ${sniff.brokerFamily} account`);
  return null;
}

/** Identify one upload and preview what importing it would do. Writes nothing. */
export async function detectUpload(db: DB, userId: string, file: UploadFile): Promise<UploadDetection> {
  const base = { filename: file.filename, snapshot: false, counts: null, priceRows: null, currency: null, suggestion: null, error: null };
  let sniff: FileSniff;
  try {
    sniff = sniffFile(file);
  } catch {
    return { ...base, kind: "unrecognized", adapter: null, confidence: 0, reason: "This file couldn't be opened", brokerFamily: null, accountRef: null, holderName: null, sheet: null, error: "unreadable" };
  }

  if (sniff.kind === "prices") {
    let priceRows = 0;
    try {
      priceRows = parseHoldingPrices(textOf(file)).length;
    } catch {
      /* counted as zero — the verdict still stands */
    }
    return { ...base, ...sniff, priceRows };
  }
  if (sniff.kind === "pnl_report") return { ...base, ...sniff, suggestion: await suggestAccount(db, userId, sniff) };
  if (sniff.kind !== "transactions" || !sniff.adapter) return { ...base, ...sniff };

  try {
    const { rows } = await resolveRows({ portfolioId: "", broker: sniff.adapter, filename: file.filename, content: file.content, encoding: file.encoding, casPassword: file.casPassword });
    let counts = await countRows(db, userId, rows);
    const suggestion = await suggestAccount(db, userId, sniff);
    const snapshot = !!getAdapter(sniff.adapter)?.snapshot;
    // A statement isn't matched row by row against trades; it's already in if it's the account's latest.
    if (snapshot && suggestion && (await sameAsLatestSnapshot(db, { userId, portfolioId: suggestion.portfolioId, accountId: suggestion.accountId }, rows))) {
      counts = { ...counts, duplicates: counts.valid, toImport: 0 };
    }
    return { ...base, ...sniff, snapshot, counts, currency: mainCurrency(rows), suggestion };
  } catch (err) {
    const code = err instanceof AppError ? err.code : null;
    if (code === "cas_password") return { ...base, ...sniff, kind: "needs_password", reason: "This statement is password-protected (usually your PAN in capitals)" };
    const message = err instanceof Error ? err.message : "Couldn't read this file";
    return { ...base, ...sniff, kind: "unrecognized", error: message, reason: message };
  }
}

export type CommitTarget =
  | { accountId: string; /** Record this client code on the account if it has none yet. */ adoptRef?: string | null }
  | {
      newAccount: {
        /** An existing portfolio (person) to put the account in, or a new person's name. */
        portfolioId?: string;
        newPortfolioName?: string;
        broker: string;
        accountRef?: string | null;
        name: string;
        currency?: string;
      };
    };

export interface CommitItem extends UploadFile {
  kind: "transactions" | "prices" | "pnl_report";
  adapter?: string;
  target?: CommitTarget;
}

export interface CommitFileResult {
  filename: string;
  kind: "transactions" | "prices" | "pnl_report";
  imported: number;
  duplicates: number;
  replaced: number;
  invalid: number;
  accountId: string | null;
  prices?: Pick<SeedPricesResult, "seeded" | "unmatchedCount">;
  reconcile?: ReconcileResult;
  /** A holdings statement: what it added beyond the trades, and what the trades hold that it doesn't list. */
  snapshot?: SnapshotSummary;
}

interface Snapshot {
  netWorth: string;
  currentValue: string;
  invested: string;
  realisedPnl: string;
  openPositions: number;
}

async function snapshot(db: DB, userId: string): Promise<Snapshot> {
  const h = await computePortfolioHoldings(db, userId);
  const s = h.summary;
  return { netWorth: s.netWorth, currentValue: s.currentValue, invested: s.invested, realisedPnl: s.realisedPnl, openPositions: s.openPositions };
}

const brokerEnum = (b: string): (typeof BROKERS)[number] => ((BROKERS as readonly string[]).includes(b) ? (b as (typeof BROKERS)[number]) : "generic");

/**
 * Commit a whole drop atomically. Files are parsed first (a bad file fails the drop before
 * anything is written); then accounts, portfolios and every file's rows land in one transaction.
 * Price snapshots are applied afterwards so they can match securities this same drop created.
 */
export async function commitMany(db: DB, userId: string, items: CommitItem[]) {
  if (items.length === 0) throw new BadRequestError("empty_drop", "No files to import");
  const before = await snapshot(db, userId);

  // 1. Parse everything up front.
  const parsed = await Promise.all(
    items.map(async (item) => {
      if (item.kind === "pnl_report") {
        if (!item.target) throw new BadRequestError("account_required", `${item.filename}: choose whose account this is`);
        let report: PnlReport;
        try {
          report = parsePnlReport(textOf(item), item.filename);
        } catch {
          throw new BadRequestError("file_unreadable", `${item.filename}: couldn't be read`);
        }
        return { item, rows: [] as NormalizedRow[], report };
      }
      if (item.kind !== "transactions") return { item, rows: [] as NormalizedRow[] };
      if (!item.adapter) throw new BadRequestError("adapter_required", `${item.filename}: no importer chosen`);
      if (!item.target) throw new BadRequestError("account_required", `${item.filename}: choose whose account this is`);
      try {
        const { rows } = await resolveRows({ portfolioId: "", broker: item.adapter, filename: item.filename, content: item.content, encoding: item.encoding, casPassword: item.casPassword });
        return { item, rows, report: undefined };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "couldn't be read";
        throw new BadRequestError(err instanceof AppError ? err.code : "file_unreadable", `${item.filename}: ${msg}`);
      }
    }),
  );

  // 2. One transaction for accounts + all ledger rows.
  const results = await db.transaction(async (trx) => {
    const createdAccounts = new Map<string, { accountId: string; portfolioId: string }>(); // one new account per (broker, ref, owner)
    const createdPortfolios = new Map<string, string>(); // new person name → id

    const resolveTarget = async (target: CommitTarget): Promise<{ accountId: string; portfolioId: string }> => {
      if ("accountId" in target) {
        const acc = await trx.select().from(accounts).where(and(eq(accounts.id, target.accountId), eq(accounts.userId, userId))).get();
        if (!acc) throw new NotFoundError("Account");
        if (target.adoptRef && !acc.accountRef) {
          await trx.update(accounts).set({ accountRef: upper(target.adoptRef), updatedAt: new Date().toISOString() }).where(eq(accounts.id, acc.id)).run();
        }
        return { accountId: acc.id, portfolioId: acc.portfolioId };
      }
      const n = target.newAccount;
      let portfolioId = n.portfolioId ?? null;
      if (portfolioId) {
        const own = await trx.select({ id: portfolios.id }).from(portfolios).where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId))).get();
        if (!own) throw new NotFoundError("Portfolio");
      } else {
        const name = (n.newPortfolioName ?? "").trim();
        if (!name) throw new BadRequestError("owner_required", "Choose whose account this is");
        portfolioId = createdPortfolios.get(name.toLowerCase()) ?? null;
        if (!portfolioId) {
          const existing = await trx.select({ id: portfolios.id }).from(portfolios).where(and(eq(portfolios.userId, userId), eq(portfolios.name, name))).get();
          portfolioId = existing?.id ?? randomUUID();
          if (!existing) await trx.insert(portfolios).values({ id: portfolioId, userId, name, kind: "family" }).run();
          createdPortfolios.set(name.toLowerCase(), portfolioId);
        }
      }
      const key = `${n.broker}|${upper(n.accountRef)}|${portfolioId}`;
      const done = createdAccounts.get(key);
      if (done) return done;
      const accountId = randomUUID();
      await trx
        .insert(accounts)
        .values({ id: accountId, userId, portfolioId, name: n.name.trim().slice(0, 120) || "Account", broker: brokerEnum(n.broker), accountRef: n.accountRef ? upper(n.accountRef) : null, currency: (n.currency ?? "INR").toUpperCase() })
        .run();
      const out = { accountId, portfolioId };
      createdAccounts.set(key, out);
      return out;
    };

    const out: CommitFileResult[] = parsed.map(({ item }) => ({ filename: item.filename, kind: item.kind, imported: 0, duplicates: 0, replaced: 0, invalid: 0, accountId: null }));
    // Trades first, holdings statements after them: a statement is checked against the trades, so
    // its summary (what it added, what it doesn't list) is only final once they're all in.
    const isStatement = (item: CommitItem) => !!(item.adapter && getAdapter(item.adapter)?.snapshot);
    const order = [...parsed.entries()].sort(([, a], [, b]) => Number(isStatement(a.item)) - Number(isStatement(b.item)));
    for (const [i, { item, rows }] of order) {
      if (item.kind !== "transactions") continue;
      const { accountId, portfolioId } = await resolveTarget(item.target!);
      const params: ImportParams = {
        portfolioId,
        accountId,
        broker: item.adapter!,
        filename: item.filename,
        content: item.content,
        encoding: item.encoding,
        casPassword: item.casPassword,
        // No period-replace here. Brokers split one account's history across files of the same type
        // over the same dates (Zerodha's equity and F&O tradebooks), so replacing a period would
        // delete a sibling file's rows. Re-uploads stay clean through dedup instead: broker trade
        // ids, else a fingerprint of each row.
        replace: false,
      };
      const r = await commitRowsInto(trx, userId, params, rows);
      out[i] = { filename: item.filename, kind: "transactions", imported: r.imported, duplicates: r.c.duplicates, replaced: r.replaced, invalid: r.c.invalidRows.length, accountId, ...(isStatement(item) && r.snapshot ? { snapshot: r.snapshot } : {}) };
    }
    // P&L reports last: they check (and complete) the ledger the trade files above just wrote.
    for (const [i, { item, report }] of parsed.entries()) {
      if (item.kind !== "pnl_report" || !report) continue;
      const target = await resolveTarget(item.target!);
      const account = await trx.select({ broker: accounts.broker }).from(accounts).where(eq(accounts.id, target.accountId)).get();
      const reconcile = await reconcileWithPnlReport(trx, userId, target, report, { broker: account?.broker ?? "broker", filename: item.filename });
      out[i] = { ...out[i]!, imported: reconcile.filled.length, accountId: target.accountId, reconcile };
    }
    return out;
  });

  // 3. Price snapshots (quotes only), after the ledger has every security from this drop.
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.kind !== "prices") continue;
    const res = await seedPricesFromHoldings(db, userId, { portfolioId: null, content: item.content, encoding: item.encoding, filename: item.filename });
    results[i] = { ...results[i]!, prices: { seeded: res.seeded, unmatchedCount: res.unmatchedCount } };
  }

  // 4. Enrichment is best effort, outside the transaction.
  try {
    await reclassifyHeld(db, userId);
  } catch {
    /* cosmetic */
  }

  bumpHoldings(userId);
  const after = await snapshot(db, userId);
  return { files: results, before, after };
}
