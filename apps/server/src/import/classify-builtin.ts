import type { AssetClass } from "@dhan-drishti/core";

/**
 * Built-in instrument classifier — assigns an asset class, sector and sub-sector from a symbol
 * or name, so the portfolio shows a meaningful sector/sub-sector breakdown out of the box
 * (a liquid fund is Debt, a gold ETF is Commodity, an SGB is a Sovereign Gold Bond, etc.).
 * It is a best-effort reference layer over imported data; users can still override via the
 * classification CSV. Precedence: pattern rules → exact symbol map → name keywords → equity.
 */
export interface Classification {
  assetClass?: AssetClass; // override when the instrument clearly isn't a plain equity
  sector: string;
  subSector?: string;
}

const has = (s: string, ...needles: string[]) => needles.some((n) => s.includes(n));

/** Exact NSE-ticker → sector map for common holdings (keyword fallback covers the long tail). */
const SYMBOL_SECTOR: Record<string, [string, string]> = {
  RELIANCE: ["Energy", "Oil & Gas"], ONGC: ["Energy", "Oil & Gas"], IOC: ["Energy", "Oil & Gas"], BPCL: ["Energy", "Oil & Gas"], GAIL: ["Energy", "Gas"], IGL: ["Energy", "Gas"], ADANIGAS: ["Energy", "Gas"], MGL: ["Energy", "Gas"], NTPC: ["Utilities", "Power"], POWERGRID: ["Utilities", "Power"], TATAPOWER: ["Utilities", "Power"], JSWENERGY: ["Utilities", "Power"], ADANIPOWER: ["Utilities", "Power"], NHPC: ["Utilities", "Power"],
  HDFCBANK: ["Financials", "Banks"], ICICIBANK: ["Financials", "Banks"], SBIN: ["Financials", "Banks"], KOTAKBANK: ["Financials", "Banks"], AXISBANK: ["Financials", "Banks"], INDUSINDBK: ["Financials", "Banks"], PNB: ["Financials", "Banks"], BANKBARODA: ["Financials", "Banks"], FEDERALBNK: ["Financials", "Banks"], IDFCFIRSTB: ["Financials", "Banks"], AUBANK: ["Financials", "Banks"], BAJFINANCE: ["Financials", "NBFC"], BAJAJFINSV: ["Financials", "NBFC"], PFC: ["Financials", "NBFC"], RECLTD: ["Financials", "NBFC"], CHOLAFIN: ["Financials", "NBFC"], MUTHOOTFIN: ["Financials", "NBFC"], SBICARD: ["Financials", "NBFC"], HDFCLIFE: ["Financials", "Insurance"], SBILIFE: ["Financials", "Insurance"], ICICIGI: ["Financials", "Insurance"], ICICIPRULI: ["Financials", "Insurance"], LICI: ["Financials", "Insurance"],
  TCS: ["IT", "IT Services"], INFY: ["IT", "IT Services"], WIPRO: ["IT", "IT Services"], HCLTECH: ["IT", "IT Services"], TECHM: ["IT", "IT Services"], LTIM: ["IT", "IT Services"], PERSISTENT: ["IT", "IT Services"], COFORGE: ["IT", "IT Services"], MPHASIS: ["IT", "IT Services"],
  HINDUNILVR: ["FMCG", "FMCG"], ITC: ["FMCG", "FMCG"], NESTLEIND: ["FMCG", "FMCG"], BRITANNIA: ["FMCG", "FMCG"], DABUR: ["FMCG", "FMCG"], MARICO: ["FMCG", "FMCG"], GODREJCP: ["FMCG", "FMCG"], TATACONSUM: ["FMCG", "FMCG"], VBL: ["FMCG", "Beverages"], COLPAL: ["FMCG", "FMCG"],
  SUNPHARMA: ["Healthcare", "Pharma"], DRREDDY: ["Healthcare", "Pharma"], CIPLA: ["Healthcare", "Pharma"], DIVISLAB: ["Healthcare", "Pharma"], LUPIN: ["Healthcare", "Pharma"], AUROPHARMA: ["Healthcare", "Pharma"], APOLLOHOSP: ["Healthcare", "Hospitals"], MAXHEALTH: ["Healthcare", "Hospitals"],
  MARUTI: ["Auto", "Automobiles"], TATAMOTORS: ["Auto", "Automobiles"], M_M: ["Auto", "Automobiles"], EICHERMOT: ["Auto", "Automobiles"], BAJAJ_AUTO: ["Auto", "Automobiles"], HEROMOTOCO: ["Auto", "Automobiles"], TVSMOTOR: ["Auto", "Automobiles"], BOSCHLTD: ["Auto", "Auto Ancillary"], MOTHERSON: ["Auto", "Auto Ancillary"],
  TATASTEEL: ["Metals", "Steel"], JSWSTEEL: ["Metals", "Steel"], JINDALSTEL: ["Metals", "Steel"], SAIL: ["Metals", "Steel"], HINDALCO: ["Metals", "Aluminium"], VEDL: ["Metals", "Diversified Metals"], NMDC: ["Metals", "Mining"], COALINDIA: ["Metals", "Mining"], APLAPOLLO: ["Metals", "Steel Products"],
  LT: ["Industrials", "Construction"], ULTRACEMCO: ["Materials", "Cement"], SHREECEM: ["Materials", "Cement"], AMBUJACEM: ["Materials", "Cement"], ACC: ["Materials", "Cement"], GRASIM: ["Materials", "Cement"], ADANIENT: ["Industrials", "Diversified"], ADANIPORTS: ["Industrials", "Ports"], SIEMENS: ["Industrials", "Capital Goods"], ABB: ["Industrials", "Capital Goods"], BEL: ["Industrials", "Defence"], HAL: ["Industrials", "Defence"], BHEL: ["Industrials", "Capital Goods"], CUMMINSIND: ["Industrials", "Capital Goods"],
  BHARTIARTL: ["Telecom", "Telecom"], IDEA: ["Telecom", "Telecom"], INDUSTOWER: ["Telecom", "Telecom"],
  DMART: ["Consumer", "Retail"], TRENT: ["Consumer", "Retail"], TITAN: ["Consumer", "Consumer Durables"], ASIANPAINT: ["Materials", "Paints"], BERGEPAINT: ["Materials", "Paints"], PIDILITIND: ["Materials", "Chemicals"], SRF: ["Materials", "Chemicals"], UPL: ["Materials", "Agrochem"], DLF: ["Realty", "Real Estate"], GODREJPROP: ["Realty", "Real Estate"], OBEROIRLTY: ["Realty", "Real Estate"],
  ALIVUS: ["Healthcare", "Pharma"], GOODLUCK: ["Metals", "Steel Products"],
};

/** Keyword → [sector, subSector] for name-based instruments (Dhan) and unmapped tickers. */
const NAME_KEYWORDS: [string[], [string, string]][] = [
  [["BANK"], ["Financials", "Banks"]],
  [["FINANCE", "FINANCIAL", "FINSERV", "CAPITAL", "FINCORP"], ["Financials", "NBFC"]],
  [["INSURANCE", "LIFE INS", "GIC", "GENERAL INS"], ["Financials", "Insurance"]],
  [["PHARMA", "LABORATOR", "HEALTHCARE", "LIFESCIENCE", "DRUG", "BIOCON"], ["Healthcare", "Pharma"]],
  [["HOSPITAL", "MEDICARE"], ["Healthcare", "Hospitals"]],
  [["OIL", "PETRO", "REFINER", "GAS "], ["Energy", "Oil & Gas"]],
  [["GAS"], ["Energy", "Gas"]],
  [["POWER", "ENERGY", "ELECTRIC"], ["Utilities", "Power"]],
  [["STEEL", "IRON", "TUBES", "PIPE", "METAL", "ALUMIN", "ZINC", "COPPER"], ["Metals", "Metals"]],
  [["CEMENT"], ["Materials", "Cement"]],
  [["MOTOR", "AUTO", "VEHICLE", "TYRE"], ["Auto", "Automobiles"]],
  [["TECH", "SOFTWARE", "INFOTECH", "SYSTEMS", "DIGITAL", "INFOSYS", "WIPRO"], ["IT", "IT Services"]],
  [["CHEMICAL", "FERTIL", "AGRO"], ["Materials", "Chemicals"]],
  [["CONSUMER", "FOODS", "FMCG", "BEVERAGE", "SUGAR", "DAIRY"], ["FMCG", "FMCG"]],
  [["CONSTRUCTION", "INFRA", "ENGINEERING", " ENG", "BUILDER"], ["Industrials", "Construction"]],
  [["REALTY", "ESTATE", "PROPERT", "HOUSING", "SPACES"], ["Realty", "Real Estate"]],
  [["TELECOM", "COMMUNICATION", "AIRTEL", "VODAFONE"], ["Telecom", "Telecom"]],
  [["PAINT"], ["Materials", "Paints"]],
  [["RETAIL", "MART", "FASHION", "APPAREL"], ["Consumer", "Retail"]],
];

export function classifyInstrument(symbolRaw: string, nameRaw?: string): Classification | null {
  const symbol = (symbolRaw ?? "").toUpperCase().trim();
  const name = (nameRaw ?? "").toUpperCase().trim();
  const both = `${symbol} ${name}`;

  // 0. Derivatives (options/futures) first — an F&O contract's name may echo its underlying (a
  // BANKNIFTY option contains "BANK"), so it must be caught before the sector keywords. Futures
  // symbols end in FUT (not "FUTURE", a real company word); options carry a numeric strike + CE/PE.
  if (/FUT\b/.test(both) || /\d{3,}\s?(?:CE|PE)\b/.test(both)) {
    return { assetClass: "other", sector: "Derivatives", subSector: /FUT\b/.test(both) ? "Futures" : "Options" };
  }

  // 1. Pattern rules for ETFs / commodities / debt / REITs (highest priority).
  if (has(both, "SGB", "SOVEREIGN GOLD")) return { assetClass: "sgb", sector: "Commodity", subSector: "Sovereign Gold Bond" };
  if (has(both, "SILVER")) return { assetClass: "etf", sector: "Commodity", subSector: "Silver" };
  if (has(both, "GOLD")) return { assetClass: "etf", sector: "Commodity", subSector: "Gold" };
  if (has(both, "LIQUID", "OVERNIGHT")) return { assetClass: "cash", sector: "Debt", subSector: "Liquid" };
  if (has(both, "GILT", "GSEC", "G-SEC", "BHARAT BOND", "BONDBEES", " SDL", "10 YEAR", "NIFTY 5 YR", "NIFTY8-13", "BONDETF")) return { assetClass: "bond", sector: "Debt", subSector: "Gilt / Bond" };
  if (has(both, "REIT", "INVIT", "EMBASSY", "MINDSPACE", "BROOKFIELD", "NEXUS", "INDIGRID", "IRB INVIT", "POWERGRID INVIT")) return { assetClass: "reit_invit", sector: "REIT / InvIT", subSector: "REIT / InvIT" };
  if (has(both, "NIFTYBEES", "JUNIORBEES", "BANKBEES", "SETFNIF", "NIFTY 50 ETF", "SENSEX ETF", "MOM50", "MID150", "SMALLCAP", "MIDCAP", "ETFNIFTY", "NIFTY IT", "NIFTY BANK ETF")) return { assetClass: "etf", sector: "Equity: Index", subSector: "Index ETF" };

  // 2. Exact ticker map.
  const mapped = SYMBOL_SECTOR[symbol.replace(/[.&-]/g, "_")] ?? SYMBOL_SECTOR[symbol];
  if (mapped) return { sector: mapped[0], subSector: mapped[1] };

  // 3. Name / symbol keyword fallback.
  for (const [needles, [sector, sub]] of NAME_KEYWORDS) if (has(both, ...needles)) return { sector, subSector: sub };

  // 4. Unknown → leave for the user to classify (don't guess a sector).
  return null;
}
