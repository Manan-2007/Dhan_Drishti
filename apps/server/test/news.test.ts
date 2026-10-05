import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { buildApp } from "../src/app.js";
import { NewsHub } from "../src/news/hub.js";
import { parseNewsRss, plainCompanyName } from "../src/news/google-news.js";
import { azureConfigFromEnv } from "../src/news/azure.js";
import type { CompanyRead, Headline, IndexSource, MarketRead, NameSource, NewsAnalyst, NewsSource } from "../src/news/types.js";

const at = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
const h = (id: string, title: string, minsAgo = 10): Headline => ({ id, title, source: "Mint", link: `https://x/${id}`, publishedAt: at(minsAgo) });

class FakeNews implements NewsSource {
  queries: string[] = [];
  byWord: Record<string, Headline[]> = {
    "Larsen & Toubro": [h("lt1", "L&T wins metro order", 5), h("lt2", "L&T shares slip", 50), h("both", "L&T and Reliance in Sensex gainers", 1)],
    "Reliance Industries": [h("ri1", "Reliance retail arm grows", 20), h("both", "L&T and Reliance in Sensex gainers", 1)],
    Sensex: [h("m1", "Sensex ends higher", 2)],
  };
  async search(q: string) {
    this.queries.push(q);
    const hit = Object.keys(this.byWord).find((w) => q.includes(w));
    return hit ? this.byWord[hit]! : [];
  }
}
class FakeNames implements NameSource {
  async nameOf(t: string) {
    return ({ "LT.BO": "Larsen & Toubro", "RELIANCE.NS": "Reliance Industries" } as Record<string, string>)[t] ?? null;
  }
}
class FakeIndices implements IndexSource {
  calls = 0;
  async getIndices() {
    this.calls++;
    return [
      { id: "nifty50", name: "Nifty 50", region: "in" as const, value: 22421.95, change: -198.5, changePct: -0.88, asOf: at(0) },
      { id: "sp500", name: "S&P 500", region: "us" as const, value: 5800, change: 10, changePct: 0.17, asOf: at(0) },
    ];
  }
}
class FakeAnalyst implements NewsAnalyst {
  label = "fake-gpt";
  seen: string[] = [];
  async readCompany(company: string, hs: Headline[]): Promise<CompanyRead> {
    this.seen.push(JSON.stringify({ company, hs }));
    return { stance: company.startsWith("Larsen") ? "tailwind" : "mixed", summary: `${company} news`, risks: ["Order delays"], outlook: "Watch results.", confidence: "medium", tones: Object.fromEntries(hs.map((x) => [x.id, "positive"])) };
  }
  async readMarket(hs: Headline[]): Promise<MarketRead> {
    this.seen.push(JSON.stringify({ hs }));
    return { mood: "positive", summary: "Up day.", themes: ["Banks"], tones: {} };
  }
}

describe("news parsing", () => {
  it("reads a Google News RSS item, splitting off the source", () => {
    const xml = `<rss><channel><item><title>Larsen &amp; Toubro Share Price Falls 2% - Univest</title><link>https://news.google.com/a1</link><pubDate>Thu, 01 Oct 2026 08:56:00 GMT</pubDate><source url="https://u">Univest</source></item></channel></rss>`;
    const [item] = parseNewsRss(xml);
    expect(item).toMatchObject({ title: "Larsen & Toubro Share Price Falls 2%", source: "Univest", link: "https://news.google.com/a1", publishedAt: "2026-10-01T08:56:00.000Z" });
    expect(item!.id).toHaveLength(16);
  });

  it("uses the name people say", () => {
    expect(plainCompanyName("Larsen & Toubro Limited")).toBe("Larsen & Toubro");
    expect(plainCompanyName("ITC Ltd.")).toBe("ITC");
    expect(plainCompanyName("State Bank of India")).toBe("State Bank of India");
  });

  it("only turns AI on with a full Azure config", () => {
    expect(azureConfigFromEnv({ AZURE_OPENAI_ENDPOINT: "https://r.openai.azure.com/", AZURE_OPENAI_API_KEY: "k" })).toBeNull();
    expect(azureConfigFromEnv({ AZURE_OPENAI_ENDPOINT: "https://r.openai.azure.com/", AZURE_OPENAI_API_KEY: "k", AZURE_OPENAI_DEPLOYMENT: "gpt" })).toMatchObject({ endpoint: "https://r.openai.azure.com", apiVersion: "2024-10-21" });
    // The full request URL copied from the Azure portal works too.
    expect(
      azureConfigFromEnv({ AZURE_OPENAI_API_KEY: "k", AZURE_OPENAI_ENDPOINT: "https://r.cognitiveservices.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2025-01-01-preview" }),
    ).toEqual({ endpoint: "https://r.cognitiveservices.azure.com", apiKey: "k", deployment: "gpt-4o", apiVersion: "2025-01-01-preview" });
  });
});

describe("news hub", () => {
  it("asks the model again only when the headlines change", async () => {
    const news = new FakeNews();
    const analyst = new FakeAnalyst();
    const hub = new NewsHub({ news, names: new FakeNames(), analyst }, { newsTtlMs: 0, marketTtlMs: 0, readGapMs: 0 });
    const lt = [{ ticker: "LT.BO", fallbackName: "LT" }];
    hub.snapshot(lt);
    await hub.settle();
    const reads = () => analyst.seen.filter((s) => s.includes("Larsen")).length;
    expect(reads()).toBe(1);
    hub.snapshot(lt); // same headlines again
    await hub.settle();
    expect(reads()).toBe(1);
    news.byWord["Larsen & Toubro"] = [h("lt3", "L&T bags defence deal", 1), ...news.byWord["Larsen & Toubro"]!];
    hub.snapshot(lt);
    await hub.settle();
    expect(reads()).toBe(2);
    expect(hub.snapshot(lt).companies[0]!.read?.stance).toBe("tailwind");
  });

  it("caches index values for a few seconds", async () => {
    const indices = new FakeIndices();
    const hub = new NewsHub({ news: new FakeNews(), names: new FakeNames(), indices });
    await Promise.all([hub.indices(), hub.indices()]);
    await hub.indices();
    expect(indices.calls).toBe(1);
  });
});

describe("GET /api/news", () => {
  let app: FastifyInstance;
  let analyst: FakeAnalyst;
  let news: FakeNews;
  let hub: NewsHub;
  beforeEach(async () => {
    const { db } = await createDb(":memory:");
    analyst = new FakeAnalyst();
    news = new FakeNews();
    hub = new NewsHub({ news, names: new FakeNames(), indices: new FakeIndices(), analyst });
    app = buildApp(db, { newsHub: hub });
    await app.ready();
  });

  async function login() {
    const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "news1", password: "supersecret1" } });
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? raw[0]! : (raw as string)).split(";")[0]!;
  }
  const post = (cookie: string, url: string, payload: object) => app.inject({ method: "POST", url, headers: { cookie }, payload });

  it("follows held companies, weights them locally and sends the model only public text", async () => {
    const cookie = await login();
    const pid = (await post(cookie, "/api/portfolios", { name: "P" })).json().portfolio.id;
    const lt = (await post(cookie, "/api/securities", { symbol: "LT", name: "LT", exchange: "BSE" })).json().security.id;
    const ri = (await post(cookie, "/api/securities", { symbol: "RELIANCE", name: "RELIANCE", exchange: "NSE" })).json().security.id;
    const gone = (await post(cookie, "/api/securities", { symbol: "SOLD", name: "Sold Co", exchange: "NSE" })).json().security.id;
    await post(cookie, "/api/transactions", { portfolioId: pid, securityId: lt, type: "buy", tradeDate: "2024-01-01", quantity: "47", price: "3111" });
    await post(cookie, "/api/transactions", { portfolioId: pid, securityId: ri, type: "buy", tradeDate: "2024-01-01", quantity: "13", price: "2917" });
    await post(cookie, "/api/transactions", { portfolioId: pid, securityId: gone, type: "buy", tradeDate: "2024-01-01", quantity: "5", price: "100" });
    await post(cookie, "/api/transactions", { portfolioId: pid, securityId: gone, type: "sell", tradeDate: "2024-02-01", quantity: "5", price: "120" });

    const first = (await app.inject({ method: "GET", url: "/api/news", headers: { cookie } })).json();
    expect(first.live).toBe(true);
    expect(first.ai).toEqual({ enabled: true, label: "fake-gpt" });
    await hub.settle();
    const r = (await app.inject({ method: "GET", url: "/api/news", headers: { cookie } })).json();

    expect(r.companies.map((c: { symbol: string }) => c.symbol)).toEqual(["LT", "RELIANCE"]); // largest first, sold one dropped
    expect(r.companies[0].name).toBe("Larsen & Toubro");
    expect(r.companies[0].weight).toBeCloseTo(146217 / (146217 + 37921), 6);
    expect(r.companies[0].read).toMatchObject({ stance: "tailwind", risks: ["Order delays"] });
    expect(r.market.read).toMatchObject({ mood: "positive" });

    // One stream, newest first, a shared headline once with both companies.
    expect(r.feed[0].id).toBe("both");
    expect(r.feed.find((f: { id: string }) => f.id === "both").companies).toHaveLength(2);
    expect(r.feed.find((f: { id: string }) => f.id === "m1").market).toBe(true);

    // Nothing about the holding reaches the search or the model: no quantities, prices or amounts.
    const outbound = [...news.queries, ...analyst.seen].join("\n");
    for (const secret of ["3111", "2917", "146217", "37921", "news1"]) expect(outbound).not.toContain(secret);
  });

  it("serves index values, each tagged with its market", async () => {
    const cookie = await login();
    const r = (await app.inject({ method: "GET", url: "/api/market/indices", headers: { cookie } })).json();
    expect(r.indices[0]).toMatchObject({ name: "Nifty 50", value: 22421.95, region: "in" });
    expect(r.indices.some((q: { region: string }) => q.region === "us")).toBe(true);
  });

  it("splits news by market and counts your stocks in each", async () => {
    const cookie = await login();
    const pid = (await post(cookie, "/api/portfolios", { name: "P" })).json().portfolio.id;
    const lt = (await post(cookie, "/api/securities", { symbol: "LT", name: "LT", exchange: "BSE" })).json().security.id;
    const aapl = (await post(cookie, "/api/securities", { symbol: "AAPL", name: "Apple", currency: "USD" })).json().security.id;
    await post(cookie, "/api/transactions", { portfolioId: pid, securityId: lt, type: "buy", tradeDate: "2024-01-01", quantity: "10", price: "3000" });
    await post(cookie, "/api/transactions", { portfolioId: pid, securityId: aapl, type: "buy", tradeDate: "2024-01-01", quantity: "5", price: "180", currency: "USD" });
    // The company list is populated from the ranked holdings synchronously — no need to wait on news.

    const inRes = (await app.inject({ method: "GET", url: "/api/news?market=in", headers: { cookie } })).json();
    expect(inRes.region).toBe("in");
    expect(inRes.markets).toEqual({ in: 1, us: 1 });
    expect(inRes.companies.map((c: { symbol: string }) => c.symbol)).toEqual(["LT"]);

    const usRes = (await app.inject({ method: "GET", url: "/api/news?market=us", headers: { cookie } })).json();
    expect(usRes.region).toBe("us");
    expect(usRes.companies.map((c: { symbol: string }) => c.symbol)).toEqual(["AAPL"]);
  });

  it("is off without a news source", async () => {
    const { db } = await createDb(":memory:");
    const plain = buildApp(db);
    await plain.ready();
    const res = await plain.inject({ method: "POST", url: "/api/auth/register", payload: { username: "news2", password: "supersecret1" } });
    const raw = res.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0]! : (raw as string)).split(";")[0]!;
    const r = (await plain.inject({ method: "GET", url: "/api/news", headers: { cookie } })).json();
    expect(r).toMatchObject({ live: false, companies: [], feed: [] });
  });
});
