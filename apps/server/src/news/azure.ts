import type { CompanyRead, Headline, MarketRead, NewsAnalyst, Stance, Tone } from "./types.js";

/**
 * Reads headlines with an Azure OpenAI deployment. Configured from the environment
 * (apps/server/.env, never committed):
 *
 *   AZURE_OPENAI_ENDPOINT     https://<resource>.openai.azure.com
 *   AZURE_OPENAI_API_KEY      the key
 *   AZURE_OPENAI_DEPLOYMENT   the deployment name (e.g. gpt-4o-mini)
 *   AZURE_OPENAI_API_VERSION  optional; default 2024-10-21, or "v1" for the v1 API
 *
 * What is sent: a company's public name and public headlines. Never a quantity, value, weight,
 * account or anything about the person — that all stays on this machine.
 */

const COMPANY_PROMPT = `You read public news headlines about one company listed in India and explain them to a careful, non-expert investor.
Reply with JSON only, in this shape:
{"stance":"tailwind|headwind|mixed|quiet","summary":"...","risks":["..."],"outlook":"...","confidence":"low|medium|high","tones":{"<headline id>":"positive|negative|neutral"}}
- stance: does this news, taken together, help (tailwind) or hurt (headwind) the company's prospects; "mixed" if both; "quiet" if nothing material.
- summary: one plain sentence on what is happening.
- risks: up to 3 short vulnerabilities the news points to (empty if none). Concrete, no jargon.
- outlook: one or two hedged sentences on what to watch in the coming weeks. Never say buy, sell or hold, never give a price target.
- confidence: how much the headlines actually support your read.
- tones: one entry for every headline id given.
Base everything on the headlines alone; if they are thin or routine (price moves, lists), say so and keep confidence low.`;

const MARKET_PROMPT = `You read today's public Indian stock-market headlines and explain the mood to a careful, non-expert investor.
Reply with JSON only, in this shape:
{"mood":"positive|negative|mixed","summary":"...","themes":["..."],"tones":{"<headline id>":"positive|negative|neutral"}}
- summary: two plain sentences on what is moving the market.
- themes: up to 4 short themes behind the news (e.g. "Crude oil prices", "Bank results").
- tones: one entry for every headline id given.
Never give buy or sell advice.`;

const STANCES: Stance[] = ["tailwind", "headwind", "mixed", "quiet"];
const TONES: Tone[] = ["positive", "negative", "neutral"];

const listOf = (hs: Headline[]) =>
  hs.map((h) => `[${h.id}] ${h.title}${h.source ? ` (${h.source})` : ""}, ${h.publishedAt.slice(0, 10)}`).join("\n");

function tonesFrom(raw: unknown, hs: Headline[]): Record<string, Tone> {
  const out: Record<string, Tone> = {};
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  for (const h of hs) {
    const t = obj[h.id];
    if (typeof t === "string" && (TONES as string[]).includes(t)) out[h.id] = t as Tone;
  }
  return out;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export interface AzureConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

/**
 * The endpoint may be the resource address ("https://x.openai.azure.com") or the full request URL
 * copied from the Azure portal (".../openai/deployments/gpt-4o/chat/completions?api-version=…");
 * the deployment and api-version are read from the latter when not set on their own.
 */
export function azureConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AzureConfig | null {
  const raw = env.AZURE_OPENAI_ENDPOINT?.trim();
  const apiKey = env.AZURE_OPENAI_API_KEY?.trim();
  if (!raw || !apiKey) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const at = url.pathname.indexOf("/openai");
  const prefix = (at >= 0 ? url.pathname.slice(0, at) : url.pathname).replace(/\/+$/, "");
  const fromPath = url.pathname.match(/\/openai\/deployments\/([^/]+)/)?.[1];
  const deployment = env.AZURE_OPENAI_DEPLOYMENT?.trim() || (fromPath ? decodeURIComponent(fromPath) : "");
  if (!deployment) return null;
  const apiVersion = env.AZURE_OPENAI_API_VERSION?.trim() || url.searchParams.get("api-version") || "2024-10-21";
  return { endpoint: `${url.origin}${prefix}`, apiKey, deployment, apiVersion };
}

export class AzureNewsAnalyst implements NewsAnalyst {
  label: string;
  constructor(
    private cfg: AzureConfig,
    private timeoutMs = 45_000,
  ) {
    this.label = cfg.deployment;
  }

  private async chat(system: string, user: string): Promise<Record<string, unknown> | null> {
    const v1 = this.cfg.apiVersion === "v1";
    const base = this.cfg.endpoint.replace(/\/openai(\/v1)?$/, "");
    const url = v1
      ? `${base}/openai/v1/chat/completions`
      : `${base}/openai/deployments/${encodeURIComponent(this.cfg.deployment)}/chat/completions?api-version=${encodeURIComponent(this.cfg.apiVersion)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", "api-key": this.cfg.apiKey },
        body: JSON.stringify({
          ...(v1 ? { model: this.cfg.deployment } : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.warn(`Azure OpenAI answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return null;
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content;
      if (!content) return null;
      const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  async readCompany(company: string, headlines: Headline[]): Promise<CompanyRead | null> {
    if (!headlines.length) return null;
    const j = await this.chat(COMPANY_PROMPT, `Company: ${company}\nHeadlines:\n${listOf(headlines)}`);
    if (!j) return null;
    const stance = (STANCES as string[]).includes(j.stance as string) ? (j.stance as Stance) : "quiet";
    const confidence = ["low", "medium", "high"].includes(j.confidence as string) ? (j.confidence as CompanyRead["confidence"]) : "low";
    return {
      stance,
      summary: str(j.summary, 400),
      risks: Array.isArray(j.risks) ? j.risks.map((r) => str(r, 200)).filter(Boolean).slice(0, 3) : [],
      outlook: str(j.outlook, 500),
      confidence,
      tones: tonesFrom(j.tones, headlines),
    };
  }

  async readMarket(headlines: Headline[]): Promise<MarketRead | null> {
    if (!headlines.length) return null;
    const j = await this.chat(MARKET_PROMPT, `Headlines:\n${listOf(headlines)}`);
    if (!j) return null;
    const mood = ["positive", "negative", "mixed"].includes(j.mood as string) ? (j.mood as MarketRead["mood"]) : "mixed";
    return {
      mood,
      summary: str(j.summary, 600),
      themes: Array.isArray(j.themes) ? j.themes.map((x) => str(x, 80)).filter(Boolean).slice(0, 4) : [],
      tones: tonesFrom(j.tones, headlines),
    };
  }
}

export function analystFromEnv(): NewsAnalyst | null {
  const cfg = azureConfigFromEnv();
  return cfg ? new AzureNewsAnalyst(cfg) : null;
}
