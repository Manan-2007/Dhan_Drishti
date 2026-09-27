import master from "./nse-master-data.json" with { type: "json" };

/**
 * Which NSE listing a broker row means, when the row doesn't carry a ticker.
 *
 * Dhan's statements name shares in words, often shortened: "POWER FINANCE CORPORATION",
 * "COMPUTER AGE MNGT SER LTD", "KOTAK BANK", "MIRAE AST NIFTY SMALLCAP 250 MQ 100 ETF". Without a
 * ticker a share gets no price, no history, and the same company can end up as three holdings.
 * This matches against NSE's own listing master (bundled; regenerate with
 * scripts/build-nse-master.mjs): by ISIN, then a ticker in brackets, then the name — where every
 * word of the broker's name has to be found in the listing's (a word may be shortened, "MNGT" for
 * MANAGEMENT; two letters may be initials, "MQ" for MOMENTUM QUALITY) and only a single best
 * listing is accepted. Anything ambiguous stays as it was. Runs offline.
 */

export type ListingKind = "equity" | "etf" | "reit_invit";
export interface Listing {
  symbol: string;
  name: string;
  isin: string | null;
  kind: ListingKind;
}

const ROWS: Listing[] = (master as [string, string, string, ListingKind][]).map(([symbol, name, isin, kind]) => ({ symbol, name, isin: isin || null, kind }));
const BY_SYMBOL = new Map(ROWS.map((r) => [r.symbol, r]));
const BY_ISIN = new Map(ROWS.filter((r) => r.isin).map((r) => [r.isin!, r]));

// Words that say nothing about which company it is.
const NOISE = new Set(["LIMITED", "LTD", "THE", "OF", "AND", "CO", "COMPANY", "INC", "PVT", "PRIVATE", "FUND", "MUTUAL", "TRI", "TOTAL", "RETURN", "INDEX", "EXCHANGE", "TRADED", "GROWTH"]);

export function nameTokens(raw: string): string[] {
  const s = raw
    .toUpperCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " AND ")
    .replace(/([A-Z])(\d)/g, "$1 $2") // NIFTY200 → NIFTY 200
    .replace(/(\d)([A-Z])/g, "$1 $2")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\b(SMALL|MID|LARGE|FLEXI|MULTI|MICRO) CAP\b/g, "$1CAP");
  return s.split(/\s+/).filter((t) => t && !NOISE.has(t));
}

/** `a` stands for `b`: equal, a prefix of 3+ letters, or its letters in order with the same first letter. */
function abbreviates(a: string, b: string): boolean {
  if (a === b) return true;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  if (a.length < 3 || a[0] !== b[0]) return false;
  if (b.startsWith(a)) return true;
  let i = 0;
  for (const c of b) if (c === a[i]) i++;
  return i === a.length;
}

/** Share of the listing's words the broker's name accounts for, or 0 if any broker word is unmatched. */
function coverage(query: string[], listing: string[]): number {
  const used = new Set<number>();
  for (const q of query) {
    let hit = listing.findIndex((w, i) => !used.has(i) && abbreviates(q, w));
    if (hit >= 0) {
      used.add(hit);
      continue;
    }
    // Initials: "MQ" → MOMENTUM QUALITY (consecutive, unused words).
    if (/^[A-Z]{2,3}$/.test(q)) {
      hit = listing.findIndex((_, i) => q.split("").every((c, k) => !used.has(i + k) && listing[i + k]?.[0] === c));
      if (hit >= 0) {
        for (let k = 0; k < q.length; k++) used.add(hit + k);
        continue;
      }
    }
    return 0;
  }
  return used.size / listing.length;
}

const TOKENS = ROWS.map((r) => nameTokens(r.name));

export function listingBySymbol(symbol: string): Listing | null {
  return BY_SYMBOL.get(symbol.trim().toUpperCase()) ?? null;
}

/** The NSE listing a broker's ISIN, ticker or name refers to — or null when it can't be sure. */
export function findListing(input: { name?: string | null; symbol?: string | null; isin?: string | null }): Listing | null {
  if (input.isin) {
    const hit = BY_ISIN.get(input.isin.trim().toUpperCase());
    if (hit) return hit;
  }
  const bracket = /\(([A-Z0-9&-]{2,})\)\s*$/i.exec(input.name ?? "")?.[1];
  if (bracket && BY_SYMBOL.has(bracket.toUpperCase())) return BY_SYMBOL.get(bracket.toUpperCase())!;
  const sym = (input.symbol ?? "").trim().toUpperCase();
  if (sym && !/\s/.test(sym) && BY_SYMBOL.has(sym)) return BY_SYMBOL.get(sym)!;

  const text = input.name || input.symbol || "";
  const query = nameTokens(text);
  if (query.length === 0) return null;
  const wantsFund = /\b(ETF|BEES|REIT|INVIT)\b/i.test(text);
  let best: { row: Listing; score: number } | null = null;
  let tied = false;
  for (let i = 0; i < ROWS.length; i++) {
    const row = ROWS[i]!;
    if (wantsFund !== (row.kind !== "equity")) continue;
    const score = coverage(query, TOKENS[i]!);
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { row, score };
      tied = false;
    } else if (score === best.score) tied = true;
  }
  // At least half of the listing's words explained, and no other listing as good.
  return best && !tied && best.score >= 0.5 ? best.row : null;
}
