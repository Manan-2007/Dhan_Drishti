export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? "error", data?.message ?? res.statusText, data?.issues);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

// ---- Shared response types (mirror the server) ----
export interface User {
  id: string;
  username: string;
  email: string | null;
  baseCurrency: string;
}
export interface Portfolio {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  baseCurrency: string;
  createdAt: string;
}
export interface Transaction {
  id: string;
  portfolioId: string;
  accountId: string | null;
  securityId: string | null;
  type: string;
  tradeDate: string;
  settleDate: string | null;
  quantity: string;
  price: string;
  grossAmount: string;
  fees: string;
  taxes: string;
  currency: string;
  fxRateToBase: string | null;
  segment: string;
  sourceBroker: string | null;
  notes: string | null;
  security: { id: string; symbol: string; name: string; isin: string | null; assetClass: string; sector: string | null; exchange: string | null } | null;
  account: { id: string; name: string; broker: string } | null;
}
/** Totals over every entry matching an Activity filter, in the base currency. */
export interface ActivitySummary {
  count: number;
  baseCurrency: string;
  bought: string;
  sold: string;
  income: string;
  charges: string;
  /** Foreign entries with no exchange rate yet, left out of the totals. */
  unconverted: number;
}
export interface ActivityPage {
  transactions: Transaction[];
  total: number;
  limit: number;
  offset: number;
  summary?: ActivitySummary;
}
export interface HoldingRow {
  security: { id: string; symbol: string; name: string; assetClass: string; sector: string | null; subSector: string | null; currency: string };
  netQty: string;
  invested: string;
  shortProceeds: string;
  avgCost: string | null;
  currentValue: string | null;
  unrealisedPnl: string | null;
  unrealisedPct: string | null;
  realisedPnl: string;
  dividends: string;
  todayChange: string | null;
  netPnl: string | null;
  hasOversell: boolean;
  /** Unsettled F&O contract past its expiry. */
  expired?: boolean;
  soldWithoutPurchase?: string;
  quote: { price: string; asOf: string; estimated: boolean } | null;
  baseInvested: string | null;
  baseCurrentValue: string | null;
  baseRealisedPnl: string | null;
  baseDividends: string | null;
  baseUnrealisedPnl: string | null;
  investedBaseAtCost: string | null;
  avgFxAtCost: string | null;
  assetReturnBase: string | null;
  currencyReturnBase: string | null;
}
export interface FxImpact {
  assetReturn: string;
  currencyReturn: string;
  total: string;
  decomposablePositions: number;
  missingCostFxCurrencies: string[];
}
export interface AllocationSlice {
  key: string;
  value: string;
  weight: string;
}
export interface ConcentrationFlag {
  severity: "info" | "warn" | "high";
  message: string;
}
export interface Diversification {
  available: boolean;
  positions: number;
  hhi: number;
  effectiveHoldings: number;
  sectors: number;
  hhiSector: number;
  score: number;
  grade: "Excellent" | "Good" | "Fair" | "Concentrated";
  top1: { label: string; weight: number; value: string } | null;
  top5Weight: number;
  topSector: { label: string; weight: number; value: string } | null;
  flags: ConcentrationFlag[];
}
export interface ManualAsset {
  id: string;
  name: string;
  assetClass: string;
  region: string;
  currency: string;
  currentValue: string;
  cost: string | null;
  baseValue: string | null;
  baseCost: string | null;
  gain: string | null;
  notes: string | null;
  valueAsOf: string | null;
  portfolioId: string | null;
  /** A deposit or bond valued from its terms. */
  deposit?: {
    interestRate: string;
    startDate: string;
    maturityDate: string | null;
    compounding: string;
    maturityValue: string | null;
    interestSoFar: string;
    daysToMaturity: number | null;
    matured: boolean;
    elapsed: number | null;
  } | null;
}
export interface ManualAssetsResult {
  baseCurrency: string;
  fxComplete: boolean;
  unconvertibleCurrencies: string[];
  total: string;
  totalCost: string;
  count: number;
  byAssetClass: { key: string; value: string }[];
  byRegion: { key: string; value: string }[];
  items: ManualAsset[];
}
export interface HoldingsResponse {
  baseCurrency: string;
  fxComplete: boolean;
  unconvertibleCurrencies: string[];
  fxImpact: FxImpact | null;
  cashTracked: boolean;
  summary: {
    invested: string;
    currentValue: string;
    unrealisedPnl: string;
    realisedPnl: string;
    dividends: string;
    netPnl: string;
    cash: string;
    manualAssets: string;
    netWorth: string;
    openPositions: number;
    pricedPositions: number;
    allPriced: boolean;
    /** Holdings with sales of shares bought before the imported history. */
    soldWithoutPurchase: number;
    /** F&O contracts closed by an estimated expiry settlement. */
    settledAtExpiry: number;
    /** Expired contracts still open (no public settlement price). */
    expiredOpen: number;
  };
  manualAssets: ManualAsset[];
  allocation: {
    basis: "current_value" | "invested";
    byAssetClass: AllocationSlice[];
    bySector: AllocationSlice[];
    bySubSector: AllocationSlice[];
    byCurrency: AllocationSlice[];
    byRegion: AllocationSlice[];
  };
  diversification: Diversification;
  holdings: HoldingRow[];
}
export type RebalanceDimension = "asset_class" | "sector";
export interface RebalanceRow {
  key: string;
  currentValue: string;
  currentWeight: string;
  targetWeight: string | null;
  targetValue: string | null;
  driftWeight: string | null;
  driftValue: string | null;
  action: "trim" | "add" | "hold" | null;
}
export interface RebalanceResponse {
  dimension: RebalanceDimension;
  basis: "current_value" | "invested";
  baseCurrency: string;
  totalValue: string;
  hasTargets: boolean;
  targetSum: string;
  untargetedWeight: string;
  rows: RebalanceRow[];
}
export interface ImportPreview {
  broker: string;
  detected: { broker: string; confidence: number; reason: string } | null;
  rowsTotal: number;
  valid: number;
  invalid: number;
  duplicates: number;
  newSecurities: number;
  toImport: number;
  invalidRows: { rowIndex: number; error: string }[];
  newSecuritySymbols: string[];
  period: { from: string; to: string } | null;
}
export interface ImportResult extends ImportPreview {
  batchId: string;
  imported: number;
  replaced: number;
}
export interface BrokerInfo {
  id: string;
  label: string;
  configurable: boolean;
  kind: "transactions" | "prices";
  brokers: string[]; // broker families this export applies to; ["*"] = any
}
export interface Account {
  id: string;
  portfolioId: string;
  name: string;
  broker: string;
  accountRef: string | null;
  currency: string;
}
export interface SeedPricesResult {
  rows: number;
  seeded: number;
  matched: string[];
  unmatched: string[];
  unmatchedCount: number;
}
export interface NetWorthPoint {
  date: string;
  netWorth: string;
  holdingsValue: string;
  cash: string;
  manualAssets: string;
  invested: string;
}
export interface NetWorthSeries {
  currency: string;
  series: NetWorthPoint[];
}
export interface CapitalGainRow {
  securityId: string;
  symbol: string;
  name: string;
  assetClass: string;
  currency: string;
  buyDate: string;
  sellDate: string;
  quantity: string;
  proceeds: string;
  cost: string;
  gain: string;
  holdingDays: number;
  term: "short" | "long";
  /** False for an opening balance: bought before the files start, real holding period unknown. */
  buyDateKnown: boolean;
  proceedsBase: string | null;
  costBase: string | null;
  gainBase: string | null;
}
export interface TermTotals {
  gain: string;
  proceeds: string;
  cost: string;
  count: number;
}
export interface UnmatchedSaleRow {
  securityId: string;
  symbol: string;
  name: string;
  currency: string;
  sellDate: string;
  quantity: string;
  proceeds: string;
  proceedsBase: string | null;
  fy: string;
}
export interface CapitalGainsReport {
  baseCurrency: string;
  rows: CapitalGainRow[];
  byFY: { key: string; shortTerm: TermTotals; longTerm: TermTotals; unknownTerm: TermTotals }[];
  fyList: string[];
  totals: { shortTerm: TermTotals; longTerm: TermTotals; unknownTerm: TermTotals };
  unmatched: UnmatchedSaleRow[];
  currencies: string[];
  fxApprox: boolean;
  disclaimer: string;
}
export interface SecurityDetail {
  security: { id: string; symbol: string; name: string; assetClass: string; sector: string | null; subSector: string | null; isin: string | null; exchange: string | null; currency: string };
  position: HoldingRow | null;
  portfolioNetPnl: string;
  baseCurrency: string;
  transactions: Transaction[];
  history: { date: string; close: number }[];
}
export interface ImportBatch {
  id: string;
  accountId: string | null;
  broker: string;
  filename: string;
  status: string;
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsInvalid: number;
  createdAt: string;
}

// ---- Drop-anything import ----
export type FileKind = "transactions" | "prices" | "pnl_report" | "not_needed" | "needs_password" | "unrecognized";
export interface AccountSuggestion {
  accountId: string;
  accountName: string;
  portfolioId: string;
  portfolioName: string;
  why: string;
  adoptRef: string | null;
}
export interface UploadDetection {
  filename: string;
  kind: FileKind;
  /** A holdings statement: checked against the account's trades, never added on top of them. */
  snapshot: boolean;
  adapter: string | null;
  confidence: number;
  reason: string;
  brokerFamily: string | null;
  accountRef: string | null;
  holderName: string | null;
  sheet: string | null;
  counts: {
    rowsTotal: number;
    valid: number;
    invalid: number;
    duplicates: number;
    newSecurities: number;
    toImport: number;
    period: { from: string; to: string } | null;
  } | null;
  priceRows: number | null;
  currency: string | null;
  suggestion: AccountSuggestion | null;
  error: string | null;
}
export type CommitTarget =
  | { accountId: string; adoptRef?: string | null }
  | { newAccount: { portfolioId?: string; newPortfolioName?: string; broker: string; accountRef?: string | null; name: string; currency?: string } };
export interface CommitManyItem {
  filename: string;
  content: string;
  encoding?: "base64";
  casPassword?: string;
  kind: "transactions" | "prices" | "pnl_report";
  adapter?: string;
  target?: CommitTarget;
}
export interface DropSnapshot {
  netWorth: string;
  currentValue: string;
  invested: string;
  realisedPnl: string;
  openPositions: number;
}
/** What a broker's P&L report found when checked against the ledger. */
export interface PnlReconcile {
  /** Closing trades the statement left out, added from the report. */
  filled: { contract: string; type: "buy" | "sell"; quantity: string; price: string; tradeDate: string }[];
  unmatched: number;
  check: {
    broker: string;
    ours: string;
    difference: string;
    from: string;
    to: string;
    /** Shares sold with no purchase in the files — bought before they start. */
    soldWithoutPurchase: number;
  } | null;
}
export interface CommitManyResult {
  files: {
    filename: string;
    kind: "transactions" | "prices" | "pnl_report";
    imported: number;
    duplicates: number;
    replaced: number;
    invalid: number;
    accountId: string | null;
    prices?: { seeded: number; unmatchedCount: number };
    reconcile?: PnlReconcile;
    /** A holdings statement: what it added beyond the trades, and what the trades hold that it doesn't list. */
    snapshot?: { asOf: string; opening: number; reduced: number; notInStatement: string[] };
  }[];
  before: DropSnapshot;
  after: DropSnapshot;
}

// ---- Live market + news ------------------------------------------------------------------

export interface IndexQuote {
  id: string;
  name: string;
  value: number;
  change: number | null;
  changePct: number | null;
  asOf: string;
}
export interface IndicesResponse {
  live: boolean;
  indices: IndexQuote[];
}

export type NewsTone = "positive" | "negative" | "neutral";
export type NewsStance = "tailwind" | "headwind" | "mixed" | "quiet";
export interface Headline {
  id: string;
  title: string;
  source: string | null;
  link: string;
  publishedAt: string;
}
export interface CompanyRead {
  stance: NewsStance;
  summary: string;
  risks: string[];
  outlook: string;
  confidence: "low" | "medium" | "high";
  tones: Record<string, NewsTone>;
}
export interface MarketRead {
  mood: "positive" | "negative" | "mixed";
  summary: string;
  themes: string[];
  tones: Record<string, NewsTone>;
}
export interface NewsCompany {
  securityId: string;
  symbol: string;
  ticker: string;
  name: string;
  /** Share of your shares (by value) — worked out on this machine, never sent out. */
  weight: number;
  loaded: boolean;
  items: Headline[];
  read: CompanyRead | null;
  readAt: string | null;
  reading: boolean;
}
export interface FeedItem extends Headline {
  tone: NewsTone | null;
  companies: { securityId: string; symbol: string; name: string }[];
  market: boolean;
}
export interface NewsResponse {
  live: boolean;
  ai: { enabled: boolean; label: string | null };
  refreshing: boolean;
  market: { items: Headline[]; read: MarketRead | null; readAt: string | null };
  companies: NewsCompany[];
  feed: FeedItem[];
}
