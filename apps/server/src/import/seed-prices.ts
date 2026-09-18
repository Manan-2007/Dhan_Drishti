import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { securities, transactions, quotes, type Security } from "../db/schema.js";
import { getPortfolioOwned } from "../domain/portfolios.js";
import { parseCsv, pick } from "./csv.js";
import { looksLikeXlsx, workbookToCsv } from "./xlsx.js";

/**
 * Price-only import from a holdings snapshot that carries a current price but no cost basis — the
 * Dhan "Holding" export is the case in point: it lists a Closing Price per scrip but no average
 * cost (and Dhan scrips aren't on Yahoo), so positions imported from a Dhan transaction report show
 * no current value until we seed these prices. We match each row to a security the user already
 * holds (by ISIN, then normalized name, then symbol) and record a quote — never a transaction, so
 * no cost basis is fabricated. Rows we can't match are reported back, not silently dropped.
 */
export interface SeedPricesParams {
  portfolioId?: string | null;
  content: string;
  encoding?: "base64";
  filename?: string;
}

export interface SeedPricesResult {
  rows: number;
  seeded: number;
  matched: string[];
  unmatched: string[];
  unmatchedCount: number;
}

const NAME = ["scrip name", "name", "symbol", "instrument", "security", "company", "stock", "tradingsymbol"];
const SYMBOL = ["symbol", "ticker", "tradingsymbol"];
const ISIN = ["isin code", "isin"];
const PRICE = ["closing price", "close price", "previous closing price", "ltp", "last price", "last traded price", "current price", "market price", "cmp"];

function num(raw: string | undefined): number {
  if (raw == null) return 0;
  const n = Number(raw.replace(/[,"%\s₹$]/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Normalize a company name for fuzzy matching across brokers: drop a trailing "(TICKER)", legal
 *  suffixes and all punctuation/spacing so "Reliance Industries" ≈ "RELIANCE INDUSTRIES LTD". */
function normName(s: string): string {
  return s
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(LTD|LIMITED|LTD\.|PVT|PRIVATE|CORP|CORPORATION|INC|CO|COMPANY)\b/g, " ")
    .replace(/[^A-Z0-9]/g, "");
}

function symbolFromName(name: string): string | undefined {
  const m = name.match(/\(([A-Z0-9&.-]{2,})\)\s*$/i);
  return m ? m[1]!.toUpperCase().trim() : undefined;
}

interface PriceRow {
  name: string;
  isin?: string;
  symbol?: string;
  price: number;
}

export function parseHoldingPrices(text: string): PriceRow[] {
  const csv = parseCsv(text);
  const out: PriceRow[] = [];
  for (const raw of csv.rows) {
    const name = pick(raw, NAME);
    if (!name) continue;
    const price = num(pick(raw, PRICE));
    if (price <= 0) continue;
    out.push({ name, isin: pick(raw, ISIN), symbol: pick(raw, SYMBOL)?.toUpperCase() ?? symbolFromName(name), price });
  }
  return out;
}

export async function seedPricesFromHoldings(db: DB, userId: string, params: SeedPricesParams): Promise<SeedPricesResult> {
  if (params.portfolioId) await getPortfolioOwned(db, userId, params.portfolioId);

  let text = params.content;
  if (params.encoding === "base64") {
    const buf = Buffer.from(params.content, "base64");
    text = looksLikeXlsx(buf, params.filename) ? workbookToCsv(buf) : buf.toString("utf8");
  }
  const priceRows = parseHoldingPrices(text);

  // Securities the user actually holds (optionally scoped to one portfolio).
  const where = params.portfolioId
    ? and(eq(transactions.userId, userId), eq(transactions.portfolioId, params.portfolioId))
    : eq(transactions.userId, userId);
  const idRows = await db.selectDistinct({ securityId: transactions.securityId }).from(transactions).where(where).all();
  const ids = idRows.map((r) => r.securityId).filter((x): x is string => !!x);
  if (ids.length === 0) return { rows: priceRows.length, seeded: 0, matched: [], unmatched: priceRows.map((r) => r.name).slice(0, 100), unmatchedCount: priceRows.length };

  const held = await db.select().from(securities).where(inArray(securities.id, ids)).all();
  const byIsin = new Map<string, Security>();
  const byNorm = new Map<string, Security>();
  const bySymbol = new Map<string, Security>();
  for (const s of held) {
    if (s.isin) byIsin.set(s.isin.toUpperCase(), s);
    if (!byNorm.has(normName(s.name))) byNorm.set(normName(s.name), s);
    if (!bySymbol.has(s.symbol.toUpperCase())) bySymbol.set(s.symbol.toUpperCase(), s);
  }

  const nowIso = new Date().toISOString();
  const matched: string[] = [];
  const unmatched: string[] = [];
  const seenSecurity = new Set<string>();
  for (const row of priceRows) {
    const hit =
      (row.isin && byIsin.get(row.isin.toUpperCase())) ||
      byNorm.get(normName(row.name)) ||
      (row.symbol && bySymbol.get(row.symbol)) ||
      null;
    if (!hit) {
      unmatched.push(row.name);
      continue;
    }
    if (seenSecurity.has(hit.id)) continue; // first price per security wins
    seenSecurity.add(hit.id);
    await db
      .insert(quotes)
      .values({ id: randomUUID(), securityId: hit.id, price: String(row.price), prevClose: null, currency: hit.currency, asOf: nowIso, provider: "import" })
      .run();
    matched.push(hit.symbol);
  }

  return { rows: priceRows.length, seeded: seenSecurity.size, matched: matched.slice(0, 100), unmatched: unmatched.slice(0, 100), unmatchedCount: unmatched.length };
}
