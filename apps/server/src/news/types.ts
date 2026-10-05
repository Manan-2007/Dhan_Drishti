/** Shapes shared by the live market strip and the news page. */

/** Which market a number belongs to — lets the UI show the India or US strip. "fx" shows in both. */
export type MarketRegion = "in" | "us" | "fx";

export interface IndexQuote {
  id: string; // e.g. "nifty50"
  name: string; // "Nifty 50"
  region: MarketRegion;
  value: number;
  change: number | null;
  changePct: number | null;
  asOf: string; // ISO time of the last trade Yahoo reports
}

/** Live index values (Nifty 50, Bank Nifty, Sensex, S&P 500, Nasdaq, Dow, USD/INR). */
export interface IndexSource {
  getIndices(): Promise<IndexQuote[]>;
}

export interface Headline {
  /** Stable id from the article link. */
  id: string;
  title: string;
  source: string | null;
  link: string;
  publishedAt: string; // ISO
}

/** Which Google News edition to search — India or US. Only the search words leave the machine. */
export type NewsEdition = "in" | "us";

/** Public news search. Only the search words leave the machine. */
export interface NewsSource {
  search(query: string, edition?: NewsEdition): Promise<Headline[]>;
}

/** A company's proper name from its public ticker ("LT.NS" → "Larsen & Toubro"). */
export interface NameSource {
  nameOf(ticker: string): Promise<string | null>;
}

export type Stance = "tailwind" | "headwind" | "mixed" | "quiet";
export type Tone = "positive" | "negative" | "neutral";

/** What the model read in one company's headlines. */
export interface CompanyRead {
  stance: Stance;
  summary: string;
  risks: string[];
  outlook: string;
  confidence: "low" | "medium" | "high";
  /** Tone per headline id. */
  tones: Record<string, Tone>;
}

/** What the model read in the day's market headlines. */
export interface MarketRead {
  mood: "positive" | "negative" | "mixed";
  summary: string;
  themes: string[];
  tones: Record<string, Tone>;
}

/**
 * Reads public headlines. It is given a company's public name and headlines and nothing else:
 * never a quantity, value, weight or anything about the person holding it.
 */
export interface NewsAnalyst {
  /** Short label for the screen, e.g. the deployment name. */
  label: string;
  readCompany(company: string, headlines: Headline[]): Promise<CompanyRead | null>;
  readMarket(headlines: Headline[]): Promise<MarketRead | null>;
}
