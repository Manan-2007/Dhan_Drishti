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
  securityId: string | null;
  type: string;
  tradeDate: string;
  quantity: string;
  price: string;
  grossAmount: string;
  fees: string;
  taxes: string;
  currency: string;
  segment: string;
  sourceBroker: string | null;
}
export interface HoldingRow {
  security: { id: string; symbol: string; name: string; assetClass: string; sector: string | null; subSector: string | null; currency: string };
  netQty: string;
  invested: string;
  avgCost: string | null;
  currentValue: string | null;
  unrealisedPnl: string | null;
  unrealisedPct: string | null;
  realisedPnl: string;
  dividends: string;
  todayChange: string | null;
  netPnl: string | null;
  hasOversell: boolean;
  quote: { price: string; asOf: string } | null;
  baseInvested: string | null;
  baseCurrentValue: string | null;
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
    netWorth: string;
    openPositions: number;
    pricedPositions: number;
    allPriced: boolean;
  };
  allocation: {
    basis: "current_value" | "invested";
    byAssetClass: AllocationSlice[];
    bySector: AllocationSlice[];
    bySubSector: AllocationSlice[];
    byCurrency: AllocationSlice[];
  };
  holdings: HoldingRow[];
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
}
export interface ImportResult extends ImportPreview {
  batchId: string;
  imported: number;
  replaced: number;
}
export interface ImportBatch {
  id: string;
  broker: string;
  filename: string;
  status: string;
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsInvalid: number;
  createdAt: string;
}
