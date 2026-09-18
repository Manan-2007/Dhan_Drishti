import type { AssetClass } from "@dhan-drishti/core";
import { TICKER_CLASS, FUND_CLASS, normFund, type RefClass } from "./classification-data.js";

/**
 * Built-in instrument classifier — assigns an asset class, sector and sub-sector so the portfolio
 * shows a meaningful breakdown automatically, with no manual step. The authoritative source is a
 * bundled NSE / AMFI reference (ticker → sector, fund name → category); pattern and keyword rules
 * cover anything outside it (name-based instruments, obscure tickers). Precedence:
 * derivatives → reference ticker → reference fund → commodity/debt/REIT patterns → keywords.
 */
export interface Classification {
  assetClass?: AssetClass; // override when the instrument clearly isn't a plain equity
  sector: string;
  subSector?: string;
  /** "reference"/"derivative" are authoritative (override existing values); "keyword" only fills blanks. */
  source: "reference" | "derivative" | "keyword";
}

const has = (s: string, ...needles: string[]) => needles.some((n) => s.includes(n));
const fromRef = (r: RefClass): Classification => ({ assetClass: r[0], sector: r[1], subSector: r[2] || undefined, source: "reference" });

/** Keyword → [sector, subSector] in the reference's vocabulary, for names outside the ticker map. */
const NAME_KEYWORDS: [string[], [string, string]][] = [
  [["BANK"], ["BFSI", "Banks"]],
  [["FINANCE", "FINANCIAL", "FINSERV", "FINCORP", "NBFC", "CAPITAL", "HOUSING FIN", "HFC"], ["BFSI", "FinServ"]],
  [["INSURANCE", "LIFE INS", "GIC", "GENERAL INS", "ASSURANCE"], ["BFSI", "Insurance"]],
  [["PHARMA", "LABORATOR", "LIFESCIENCE", "DRUG", "BIOCON"], ["HealthCare", "Pharma"]],
  [["HOSPITAL", "MEDICARE", "DIAGNOSTIC", "HEALTHCARE"], ["HealthCare", "Hospital"]],
  [["OIL", "PETRO", "REFINER"], ["Oil_Gas", "Oil"]],
  [["GAS"], ["Oil_Gas", "Gas"]],
  [["SOLAR", "RENEW", "GREEN ENERGY", "WIND"], ["Energy", "GreenEnergy"]],
  [["POWER", "ENERGY", "ELECTRIC"], ["Energy", "Power"]],
  [["STEEL", "IRON", "TUBES", "PIPE", "METAL", "ALUMIN", "ZINC", "COPPER"], ["Metal", "Metal"]],
  [["CEMENT"], ["Infra", "Cement"]],
  [["MOTOR", "AUTO", "VEHICLE", "TYRE"], ["Auto", "AutoAncy"]],
  [["TECH", "SOFTWARE", "INFOTECH", "SYSTEMS", "DIGITAL", "INFOSYS", "WIPRO"], ["IT", "IT"]],
  [["CHEMICAL", "FERTIL", "AGRO"], ["Chemicals", "Chemicals"]],
  [["CONSUMER", "FOODS", "FMCG", "BEVERAGE", "SUGAR", "DAIRY"], ["FMCG", "FMCG"]],
  [["DEFENCE", "DEFENSE"], ["Defence", "Defence"]],
  [["CONSTRUCTION", "INFRA", "ENGINEERING", "BUILDER", "CAPITAL GOODS"], ["Infra", "Constr"]],
  [["REALTY", "ESTATE", "PROPERT", "SPACES"], ["RealEstate", "RealEstate"]],
  [["TELECOM", "COMMUNICATION", "AIRTEL", "VODAFONE"], ["TeleCom", "Telecom"]],
  [["LOGISTIC", "TRANSPORT", "CARGO"], ["Misc", "Logistics"]],
  [["HOTEL", "HOSPITALITY", "RESORT"], ["Hospitality", "Hotel"]],
  [["RETAIL", "MART", "FASHION", "APPAREL", "TEXTILE"], ["Misc", "Textiles"]],
];

/** Resolve a broker symbol to a reference ticker, tolerating Zerodha series suffixes (…-GB, …-F). */
function refTicker(symbol: string): RefClass | undefined {
  return TICKER_CLASS[symbol] ?? TICKER_CLASS[symbol.replace(/-[A-Z0-9]+$/, "")] ?? TICKER_CLASS[symbol.replace(/[^A-Z0-9]/g, "")];
}

export function classifyInstrument(symbolRaw: string, nameRaw?: string): Classification | null {
  const symbol = (symbolRaw ?? "").toUpperCase().trim();
  const name = (nameRaw ?? "").toUpperCase().trim();
  const both = `${symbol} ${name}`;

  // 0. Derivatives (options/futures) — a contract's name may echo its underlying, so catch first.
  if (/FUT\b/.test(both) || /\d{3,}\s?(?:CE|PE)\b/.test(both)) {
    return { assetClass: "other", sector: "Derivatives", subSector: /FUT\b/.test(both) ? "Futures" : "Options", source: "derivative" };
  }

  // 1. Authoritative reference: exact ticker, then fund by normalized name.
  const t = refTicker(symbol);
  if (t) return fromRef(t);
  const f = FUND_CLASS[normFund(name)] ?? FUND_CLASS[normFund(symbol)];
  if (f) return fromRef(f);

  // 2. Commodity / debt / REIT patterns for instruments outside the reference sheet.
  if (has(both, "SGB", "SOVEREIGN GOLD")) return { assetClass: "sgb", sector: "Gold", subSector: "SGB", source: "keyword" };
  if (has(both, "SILVER")) return { assetClass: "etf", sector: "Silver", subSector: "Silver", source: "keyword" };
  if (has(both, "GOLD")) return { assetClass: "etf", sector: "Gold", subSector: "Gold", source: "keyword" };
  if (has(both, "LIQUID", "OVERNIGHT", "MONEY MARKET")) return { sector: "Debt", subSector: "Liquid", source: "keyword" };
  if (has(both, "GILT", "GSEC", "G-SEC", "BHARAT BOND", "BONDBEES", " SDL", "BONDETF", "10 YEAR")) return { assetClass: "bond", sector: "Debt", subSector: "Debt", source: "keyword" };
  if (has(both, "REIT", "INVIT")) return { assetClass: "reit_invit", sector: "RealEstate", subSector: "REIT", source: "keyword" };

  // 3. Name / symbol keyword fallback (reference vocabulary).
  for (const [needles, [sector, sub]] of NAME_KEYWORDS) if (has(both, ...needles)) return { sector, subSector: sub, source: "keyword" };

  // 4. Unknown → leave for automatic reclassification on a future import (don't guess).
  return null;
}
