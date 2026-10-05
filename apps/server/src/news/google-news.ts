import { createHash } from "node:crypto";
import type { Headline, NameSource, NewsEdition, NewsSource } from "./types.js";

/** Google News locale params per edition. */
const EDITION = {
  in: { hl: "en-IN", gl: "IN", ceid: "IN:en" },
  us: { hl: "en-US", gl: "US", ceid: "US:en" },
} as const;

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]!) : null;
};

/** Parse a Google News RSS document. Titles come as "Headline - Source"; the source is split off. */
export function parseNewsRss(xml: string): Headline[] {
  const out: Headline[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = m[1]!;
    const link = tag(item, "link");
    let title = tag(item, "title");
    if (!link || !title) continue;
    const source = tag(item, "source");
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    const when = Date.parse(tag(item, "pubDate") ?? "");
    out.push({
      id: createHash("sha1").update(link).digest("hex").slice(0, 16),
      title,
      source,
      link,
      publishedAt: new Date(Number.isFinite(when) ? when : Date.now()).toISOString(),
    });
  }
  return out;
}

/** Google News search (public RSS, no key). Edition picks the India or US locale; only the search
 *  words are sent. */
export class GoogleNewsSource implements NewsSource {
  constructor(private timeoutMs = 8000) {}

  async search(query: string, edition: NewsEdition = "in"): Promise<Headline[]> {
    const loc = EDITION[edition];
    const url = `https://news.google.com/rss/search?${new URLSearchParams({ q: query, ...loc })}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok) return [];
      return parseNewsRss(await res.text());
    } catch {
      return [];
    } finally {
      clearTimeout(t);
    }
  }
}

/** "Larsen & Toubro Limited" → "Larsen & Toubro": what people call it in headlines. */
export function plainCompanyName(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .replace(/[.,]?\s+(limited|ltd\.?|inc\.?|corporation|corp\.?|plc|co\.)$/i, "")
    .replace(/[.,]?\s+(limited|ltd\.?)$/i, "")
    .trim();
}

/** Company names from Yahoo's public chart endpoint (no key); only the ticker is sent. */
export class YahooNameSource implements NameSource {
  constructor(private timeoutMs = 6000) {}

  async nameOf(ticker: string): Promise<string | null> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok) return null;
      const json = (await res.json()) as { chart?: { result?: { meta?: { longName?: string; shortName?: string } }[] } };
      const meta = json.chart?.result?.[0]?.meta;
      const name = meta?.longName ?? meta?.shortName ?? null;
      return name ? plainCompanyName(name) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }
}
