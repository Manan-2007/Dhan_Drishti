import type { AssetClass } from "@dhan-drishti/core";
import listings from "./us-listings-data.json" with { type: "json" };

/**
 * US holdings classified from the bundled Nasdaq reference (scripts/build-us-listings.mjs), the way
 * Indian ones are from the NSE reference: the company's name, a sector in the same vocabulary as
 * Indian shares (so a US chip-maker and an Indian IT stock sit side by side), and the industry as
 * the sub-sector. ETFs are recognised and grouped by what their name says they hold.
 */
export interface UsListing {
  assetClass: AssetClass;
  sector: string;
  subSector?: string;
  name: string;
}

const data = listings as unknown as { asOf: string; stocks: Record<string, [string, string, string]>; etfs: Record<string, string> };

/** Nasdaq's sectors → the app's sector vocabulary (shared with the NSE reference). */
const SECTOR: Record<string, string> = {
  Technology: "IT",
  Finance: "BFSI",
  "Health Care": "HealthCare",
  "Consumer Staples": "FMCG",
  "Consumer Discretionary": "Consumer",
  Industrials: "CapitalGoods",
  Energy: "Oil_Gas",
  Utilities: "Energy",
  "Real Estate": "RealEstate",
  "Basic Materials": "Metal",
  Telecommunications: "TeleCom",
  Miscellaneous: "Misc",
};

/** An industry that says more than its sector does (Tesla is "Industrials" but plainly Auto). */
function sectorOf(sector: string, industry: string): string {
  if (/auto(mobile| manufactur| parts)/i.test(industry)) return "Auto";
  if (/aerospace|defen[cs]e|ordnance/i.test(industry)) return "Defence";
  if (/chemical/i.test(industry) && sector === "Basic Materials") return "Chemicals";
  if (/bank/i.test(industry)) return "BFSI";
  return SECTOR[sector] ?? "Misc";
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** What an ETF holds, from its name: [sector, sub-sector]. Asset type and themes first… */
const THEME_RULES: [RegExp, string, string][] = [
  [/\b(BOND|TREASURY|T-BILL|AGGREGATE|MUNI|MUNICIPAL|CREDIT|CLO|FIXED INCOME|MORTGAGE|TIPS|FLOATING RATE)\b/, "Debt", "Bonds"],
  [/\bGOLD\b/, "Gold", "Gold"],
  [/\bSILVER\b/, "Silver", "Silver"],
  [/PREMIUM INCOME|HIGH INCOME|OPTION INCOME|COVERED CALL|BUY-?WRITE|ENHANCED INCOME|YIELDMAX/, "Income", "Option income"],
  [/SEMICONDUCTOR|\bSOX\b/, "Sectorial", "Semiconductors"],
  [/CYBER ?SECURITY/, "Sectorial", "Cybersecurity"],
  [/QUANTUM/, "Sectorial", "Quantum computing"],
  [/BITCOIN|ETHER(EUM)?|CRYPTO|BLOCKCHAIN/, "Sectorial", "Crypto"],
  [/ARTIFICIAL INTELLIGENCE|ROBOTIC|\bAI\b/, "Sectorial", "AI & robotics"],
  [/INNOVATION|DISRUPT|NEXT GENERATION INTERNET|GENOMIC/, "Sectorial", "Innovation"],
  [/URANIUM|CLEAN ENERGY|SOLAR|LITHIUM|BATTERY/, "Sectorial", "Clean energy"],
  [/BIOTECH|HEALTH ?CARE|PHARMA|MEDICAL/, "Sectorial", "Healthcare"],
  [/FINANCIAL|\bBANKS?\b|REGIONAL BANK|INSURANCE/, "Sectorial", "Financials"],
  [/\bENERGY\b|OIL|NATURAL GAS/, "Sectorial", "Energy"],
  [/REAL ESTATE|\bREIT/, "Sectorial", "Real estate"],
  [/SOFTWARE|CLOUD|INTERNET|TECHNOLOGY|\bTECH\b/, "Sectorial", "Technology"],
  [/DEFEN[CS]E|AEROSPACE/, "Sectorial", "Defence"],
  [/INFRASTRUCTURE/, "Sectorial", "Infrastructure"],
  [/UTILIT/, "Sectorial", "Utilities"],
  [/MATERIALS|METALS|MINING|MINERS/, "Sectorial", "Materials"],
  [/CONSUMER/, "Sectorial", "Consumer"],
  [/INDUSTRIAL/, "Sectorial", "Industrials"],
];
/** …then broad market indexes (only if it isn't a country or region fund). */
const INDEX_RULES: [RegExp, string, string][] = [
  [/S&P 500|\bSP 500\b/, "Index", "S&P 500"],
  [/NASDAQ[- ]?100|NASDAQ 100|NEXT GEN 100|NASDAQ/, "Index", "Nasdaq"],
  [/TOTAL (STOCK )?MARKET|TOTAL US/, "Index", "Total market"],
  [/RUSSELL|SMALL[- ]?CAP|MID[- ]?CAP/, "Index", "Small & mid cap"],
  [/DOW JONES|\bDOW\b/, "Index", "Dow"],
  [/MOMENTUM|FACTOR|QUALITY|LOW VOLATILITY|MIN(IMUM)? VOL|EQUAL WEIGHT|VALUE|GROWTH|DIVIDEND/, "Index", "Factor"],
  [/MSCI USA|LARGE[- ]?CAP|\b1000\b/, "Index", "US large cap"],
];
/** A country or region in the name (checked after themes: "Global X Uranium" is a uranium fund). */
const REGION = /\b(SOUTH KOREA|KOREA|CHINA|HONG KONG|JAPAN|INDIA|TAIWAN|BRAZIL|GERMANY|UNITED KINGDOM|CANADA|MEXICO|AUSTRALIA|SINGAPORE|VIETNAM|ISRAEL|EUROPE|EMERGING MARKETS?|INTERNATIONAL|EAFE|ALL COUNTRY|ACWI|EX-US|EX US|LATIN AMERICA|ASIA|PACIFIC)\b/;

function classifyEtf(name: string): Pick<UsListing, "sector" | "subSector"> {
  const n = name.toUpperCase();
  for (const [re, sector, sub] of THEME_RULES) if (re.test(n)) return { sector, subSector: sub };
  const region = n.match(REGION);
  if (region) return { sector: "Global", subSector: titleCase(region[1]!) };
  for (const [re, sector, sub] of INDEX_RULES) if (re.test(n)) return { sector, subSector: sub };
  return { sector: "Index", subSector: "Other index" };
}

/** A US ticker → its listing, or null when the reference doesn't know it. */
export function classifyUsListing(symbolRaw: string): UsListing | null {
  const symbol = symbolRaw.trim().toUpperCase().replace(/\./g, "-");
  const etf = data.etfs[symbol] ?? data.etfs[symbolRaw.trim().toUpperCase()];
  if (etf) return { assetClass: "etf", name: etf, ...classifyEtf(etf) };
  const stock = data.stocks[symbol] ?? data.stocks[symbol.replace(/-/g, "/")] ?? data.stocks[symbolRaw.trim().toUpperCase()];
  if (!stock) return null;
  const [name, sector, industry] = stock;
  return { assetClass: "equity", name, sector: sectorOf(sector, industry), subSector: industry || undefined };
}
