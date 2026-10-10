import { eq } from "drizzle-orm";
import type { DB } from "../../db/index.js";
import { fundamentalsCache } from "../../db/schema.js";
import type { Fundamentals, FundamentalsProvider } from "./yahoo-fundamentals.js";

const FRESH_MS = 24 * 3600_000;

/**
 * Where fundamentals come from, in order: the local copy (fresh for a day, and kept through
 * restarts so providers aren't re-asked), then — for US listings — Nasdaq's public data, with Yahoo
 * only filling what Nasdaq doesn't give (forward P/E, PEG); Indian listings use Yahoo. When nothing
 * answers, the last copy is returned, however old, rather than nothing.
 */
export class CachedFundamentals implements FundamentalsProvider {
  constructor(
    private db: DB,
    private us: FundamentalsProvider | null,
    private yahoo: FundamentalsProvider | null,
  ) {}

  private async stored(ticker: string): Promise<{ value: Fundamentals; at: number } | null> {
    const row = await this.db.select().from(fundamentalsCache).where(eq(fundamentalsCache.ticker, ticker)).get();
    if (!row) return null;
    try {
      return { value: JSON.parse(row.data) as Fundamentals, at: Date.parse(row.fetchedAt) };
    } catch {
      return null;
    }
  }

  async getFundamentals(ticker: string): Promise<Fundamentals | null> {
    const saved = await this.stored(ticker);
    if (saved && Date.now() - saved.at < FRESH_MS) return saved.value;

    const isUs = !/\.(NS|BO)$/i.test(ticker);
    const primary = isUs && this.us ? await this.us.getFundamentals(ticker).catch(() => null) : null;
    const yahoo = this.yahoo ? await this.yahoo.getFundamentals(ticker).catch(() => null) : null;
    let value: Fundamentals | null = primary;
    if (primary && yahoo) {
      // Nasdaq's figures stand; Yahoo fills only the blanks.
      const merged = { ...primary } as Record<string, unknown>;
      for (const [k, v] of Object.entries(yahoo)) if (merged[k] == null && v != null) merged[k] = v;
      value = { ...(merged as unknown as Fundamentals), source: "Nasdaq + Yahoo" };
    } else if (!primary) value = yahoo;

    if (!value) return saved?.value ?? null;
    const fetchedAt = new Date().toISOString();
    await this.db
      .insert(fundamentalsCache)
      .values({ ticker, data: JSON.stringify(value), fetchedAt })
      .onConflictDoUpdate({ target: fundamentalsCache.ticker, set: { data: JSON.stringify(value), fetchedAt } })
      .run();
    return value;
  }
}
