import type { CompanyRead, Headline, IndexQuote, IndexSource, MarketRead, NameSource, NewsAnalyst, NewsSource } from "./types.js";

/**
 * Keeps the news fresh without making anyone wait. A request gets whatever is cached and, for
 * anything older than its time-to-live, kicks off a refresh in the background; the screen polls
 * and picks the new headlines up a few seconds later.
 *
 * The model is asked again about a company only when its top headlines have changed, and not more
 * often than `readGapMs`, so a steady trickle of news doesn't turn into a steady trickle of bills.
 * Everything here is public (tickers, names, headlines) and shared between users.
 */

export interface HubSources {
  news: NewsSource;
  names: NameSource;
  indices?: IndexSource;
  analyst?: NewsAnalyst | null;
}

export interface HubOptions {
  newsTtlMs?: number;
  marketTtlMs?: number;
  indexTtlMs?: number;
  readGapMs?: number;
  headlinesPerCompany?: number;
}

export interface CompanyKey {
  /** Public ticker the name and news are looked up by, e.g. "LT.NS". */
  ticker: string;
  /** Used when no proper name can be found. */
  fallbackName: string;
}

interface Stamped<T> {
  value: T;
  at: number;
}

const MARKET_QUERY = "(Sensex OR Nifty) stock market when:1d";
const companyQuery = (name: string) => `"${name}" (stock OR shares OR "share price") when:7d`;
/** Headlines that decide whether a read is out of date. */
const READ_BASIS = 8;

class Limiter {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

const fingerprint = (hs: Headline[]) => hs.slice(0, READ_BASIS).map((h) => h.id).sort().join(",");
const newestFirst = (a: Headline, b: Headline) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0);

export class NewsHub {
  private names = new Map<string, string>();
  private feeds = new Map<string, Stamped<Headline[]>>();
  private reads = new Map<string, Stamped<CompanyRead> & { basis: string }>();
  private market: Stamped<Headline[]> | null = null;
  private marketRead: (Stamped<MarketRead> & { basis: string }) | null = null;
  private indexCache: Stamped<IndexQuote[]> | null = null;
  private indexInFlight: Promise<IndexQuote[]> | null = null;

  private busy = new Set<string>();
  private pending = new Set<Promise<unknown>>();
  private fetchLimit = new Limiter(4);
  private readLimit = new Limiter(2);
  private o: Required<HubOptions>;

  constructor(
    private src: HubSources,
    opts: HubOptions = {},
  ) {
    this.o = {
      newsTtlMs: opts.newsTtlMs ?? 3 * 60_000,
      marketTtlMs: opts.marketTtlMs ?? 2 * 60_000,
      indexTtlMs: opts.indexTtlMs ?? 5_000,
      readGapMs: opts.readGapMs ?? 15 * 60_000,
      headlinesPerCompany: opts.headlinesPerCompany ?? 12,
    };
  }

  get analystLabel(): string | null {
    return this.src.analyst?.label ?? null;
  }

  /** Wait for every background refresh started so far (tests). */
  async settle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private background(key: string, job: () => Promise<void>): void {
    if (this.busy.has(key)) return;
    this.busy.add(key);
    const p = job()
      .catch(() => undefined)
      .finally(() => {
        this.busy.delete(key);
        this.pending.delete(p);
      });
    this.pending.add(p);
  }

  // ---- indices -------------------------------------------------------------------------

  async indices(): Promise<IndexQuote[]> {
    const src = this.src.indices;
    if (!src) return [];
    const c = this.indexCache;
    if (c && Date.now() - c.at < this.o.indexTtlMs) return c.value;
    this.indexInFlight ??= src
      .getIndices()
      .then((v) => {
        // Keep the last good values through a failed fetch.
        if (v.length) this.indexCache = { value: v, at: Date.now() };
        return this.indexCache?.value ?? v;
      })
      .finally(() => (this.indexInFlight = null));
    return this.indexInFlight;
  }

  // ---- companies -----------------------------------------------------------------------

  private stale(s: Stamped<unknown> | null | undefined, ttl: number) {
    return !s || Date.now() - s.at >= ttl;
  }

  private refreshCompany(c: CompanyKey): void {
    this.background(`news:${c.ticker}`, () =>
      this.fetchLimit.run(async () => {
        let name = this.names.get(c.ticker);
        if (!name) {
          name = (await this.src.names.nameOf(c.ticker)) ?? c.fallbackName;
          this.names.set(c.ticker, name);
        }
        const found = await this.src.news.search(companyQuery(name));
        const seen = new Set<string>();
        const items = found
          .filter((h) => (seen.has(h.title.toLowerCase()) ? false : (seen.add(h.title.toLowerCase()), true)))
          .sort(newestFirst)
          .slice(0, this.o.headlinesPerCompany);
        // A failed search keeps what was there; an empty answer is still recorded as fresh.
        if (items.length || !this.feeds.has(c.ticker)) this.feeds.set(c.ticker, { value: items, at: Date.now() });
        else this.feeds.get(c.ticker)!.at = Date.now();
        this.maybeRead(c.ticker, name);
      }),
    );
  }

  private maybeRead(ticker: string, name: string): void {
    const analyst = this.src.analyst;
    const items = this.feeds.get(ticker)?.value ?? [];
    if (!analyst || !items.length) return;
    const basis = fingerprint(items);
    const prev = this.reads.get(ticker);
    if (prev && (prev.basis === basis || Date.now() - prev.at < this.o.readGapMs)) return;
    this.background(`read:${ticker}`, () =>
      this.readLimit.run(async () => {
        const read = await analyst.readCompany(name, items.slice(0, READ_BASIS));
        if (read) this.reads.set(ticker, { value: read, at: Date.now(), basis });
      }),
    );
  }

  private refreshMarket(): void {
    this.background("news:market", () =>
      this.fetchLimit.run(async () => {
        const items = (await this.src.news.search(MARKET_QUERY)).sort(newestFirst).slice(0, 15);
        if (items.length || !this.market) this.market = { value: items, at: Date.now() };
        else this.market.at = Date.now();
        const analyst = this.src.analyst;
        if (!analyst || !items.length) return;
        const basis = fingerprint(items);
        const prev = this.marketRead;
        if (prev && (prev.basis === basis || Date.now() - prev.at < this.o.readGapMs)) return;
        const read = await this.readLimit.run(() => analyst.readMarket(items.slice(0, 12)));
        if (read) this.marketRead = { value: read, at: Date.now(), basis };
      }),
    );
  }

  /** What is known right now for these companies; refreshes anything stale in the background. */
  snapshot(companies: CompanyKey[]) {
    if (this.stale(this.market, this.o.marketTtlMs)) this.refreshMarket();
    for (const c of companies) if (this.stale(this.feeds.get(c.ticker), this.o.newsTtlMs)) this.refreshCompany(c);
    const iso = (t: number | undefined) => (t ? new Date(t).toISOString() : null);
    return {
      refreshing: this.busy.size > 0,
      market: {
        items: this.market?.value ?? [],
        read: this.marketRead?.value ?? null,
        readAt: iso(this.marketRead?.at),
      },
      companies: companies.map((c) => ({
        ticker: c.ticker,
        name: this.names.get(c.ticker) ?? c.fallbackName,
        loaded: this.feeds.has(c.ticker),
        items: this.feeds.get(c.ticker)?.value ?? [],
        read: this.reads.get(c.ticker)?.value ?? null,
        readAt: iso(this.reads.get(c.ticker)?.at),
        reading: this.busy.has(`read:${c.ticker}`),
      })),
    };
  }
}
