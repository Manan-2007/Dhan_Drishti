/**
 * OpenAPI 3.1 description of the Dhan Drishti REST API — the single machine-readable contract
 * for headless clients (load into Swagger UI, Redoc, Postman, or an SDK generator). It is
 * hand-maintained to match the routes in `src/domain/*`; served at `GET /api/openapi.json`.
 *
 * Auth is a session cookie (`dd_session`) issued by the auth endpoints; every `/api/*` route
 * except the auth and discovery endpoints requires it. Errors share one envelope:
 * `{ "error": "<code>", "message": "<human text>" }` (validation errors add `issues`).
 */

export const API_VERSION = "1.0.0";

const json = (schema: unknown) => ({ content: { "application/json": { schema } } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const ERR = (desc: string) => ({ description: desc, ...json(ref("Error")) });

// Standard error responses reused across authenticated routes.
const AUTH_ERRORS = {
  "401": ERR("Not authenticated"),
  "404": ERR("Not found or not owned by the caller"),
  "400": { description: "Validation error", ...json(ref("ValidationError")) },
};

const portfolioIdParam = {
  name: "portfolioId",
  in: "query",
  required: false,
  description: "Restrict to a single portfolio (owned by the caller). Omit for all portfolios.",
  schema: { type: "string" },
};
const idPath = { name: "id", in: "path", required: true, schema: { type: "string" } };

/** A CRUD-ish authenticated operation with a summary + tag + responses. */
function op(tag: string, summary: string, extra: Record<string, unknown> = {}) {
  return { tags: [tag], summary, security: [{ cookieAuth: [] }], responses: { ...AUTH_ERRORS }, ...extra };
}

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Dhan Drishti API",
    version: API_VERSION,
    description:
      "Private, self-hosted investment portfolio & wealth tracker. Broker CSV → canonical " +
      "transaction ledger → derived holdings → analytics. All data is per-user and stays local; " +
      "only public symbols are sent to price providers. Money values are decimal strings, never floats.",
  },
  servers: [{ url: "/", description: "This server" }],
  tags: [
    { name: "Auth", description: "Registration, login, session" },
    { name: "Portfolios", description: "Portfolios (grouping of accounts/holdings)" },
    { name: "Accounts", description: "Broker accounts within a portfolio" },
    { name: "Securities", description: "Shared security master + classification" },
    { name: "Transactions", description: "The canonical transaction ledger" },
    { name: "Holdings", description: "Derived holdings, allocation, base-currency & FX impact" },
    { name: "Imports", description: "Broker CSV import (preview + commit)" },
    { name: "Market data", description: "Price refresh and status" },
    { name: "Exchange rates", description: "FX rates, refresh, backfill" },
    { name: "Performance", description: "Realised P&L, XIRR, benchmark comparison" },
    { name: "Dividends", description: "Dividend & interest income" },
    { name: "Goals", description: "Savings/target goals funded by portfolios" },
    { name: "Account", description: "Data export & account deletion" },
    { name: "Meta", description: "Health, discovery, API schema (no auth)" },
  ],
  paths: {
    "/health": { get: { tags: ["Meta"], summary: "Liveness probe", security: [], responses: { "200": { description: "OK" } } } },
    "/api": { get: { tags: ["Meta"], summary: "API index & endpoint discovery", security: [], responses: { "200": { description: "API metadata" } } } },
    "/api/openapi.json": { get: { tags: ["Meta"], summary: "This OpenAPI document", security: [], responses: { "200": { description: "OpenAPI 3.1 spec" } } } },

    "/api/auth/register": {
      post: { tags: ["Auth"], summary: "Create a user and start a session", security: [],
        requestBody: json(ref("RegisterInput")), responses: { "201": { description: "Created; sets session cookie", ...json(ref("UserWrap")) }, "400": { description: "Validation error", ...json(ref("ValidationError")) }, "409": ERR("Username taken") } },
    },
    "/api/auth/login": {
      post: { tags: ["Auth"], summary: "Authenticate and start a session", security: [],
        requestBody: json(ref("Credentials")), responses: { "200": { description: "Session cookie set", ...json(ref("UserWrap")) }, "401": ERR("Invalid credentials") } },
    },
    "/api/auth/logout": { post: { tags: ["Auth"], summary: "End the current session", security: [{ cookieAuth: [] }], responses: { "200": { description: "Cookie cleared" } } } },
    "/api/auth/me": { get: op("Auth", "The current user", { responses: { "200": { description: "Current user", ...json(ref("UserWrap")) }, "401": ERR("Not authenticated") } }) },

    "/api/portfolios": {
      get: op("Portfolios", "List portfolios", { responses: { "200": { description: "Portfolios", ...json({ type: "object", properties: { portfolios: { type: "array", items: ref("Portfolio") } } }) }, "401": ERR("Not authenticated") } }),
      post: op("Portfolios", "Create a portfolio", { requestBody: json(ref("PortfolioInput")), responses: { "201": { description: "Created", ...json(ref("PortfolioWrap")) }, ...AUTH_ERRORS, "409": ERR("Name already exists") } }),
    },
    "/api/portfolios/{id}": {
      parameters: [idPath],
      get: op("Portfolios", "Get a portfolio", { responses: { "200": { description: "Portfolio", ...json(ref("PortfolioWrap")) }, ...AUTH_ERRORS } }),
      put: op("Portfolios", "Update a portfolio", { requestBody: json(ref("PortfolioInput")), responses: { "200": { description: "Updated", ...json(ref("PortfolioWrap")) }, ...AUTH_ERRORS } }),
      delete: op("Portfolios", "Delete a portfolio", { responses: { "200": { description: "Deleted", ...json(ref("Ok")) }, ...AUTH_ERRORS } }),
    },

    "/api/accounts": {
      get: op("Accounts", "List accounts"),
      post: op("Accounts", "Create an account", { requestBody: json(ref("AccountInput")), responses: { "201": { description: "Created" }, ...AUTH_ERRORS } }),
    },
    "/api/accounts/{id}": {
      parameters: [idPath],
      get: op("Accounts", "Get an account"),
      put: op("Accounts", "Update an account"),
      delete: op("Accounts", "Delete an account", { responses: { "200": { description: "Deleted", ...json(ref("Ok")) }, ...AUTH_ERRORS } }),
    },

    "/api/securities": {
      get: op("Securities", "Search the security master", { parameters: [{ name: "query", in: "query", schema: { type: "string" }, description: "Symbol / name / ISIN substring" }, { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 } }] }),
      post: op("Securities", "Find-or-create a security (ISIN → symbol+exchange → symbol)", { requestBody: json(ref("SecurityInput")), responses: { "200": { description: "Existing security", ...json(ref("SecurityWrap")) }, "201": { description: "Created security", ...json(ref("SecurityWrap")) }, ...AUTH_ERRORS } }),
    },
    "/api/securities/{id}": {
      parameters: [idPath],
      get: op("Securities", "Get a security"),
      put: op("Securities", "Edit security metadata (name, class, sector…)", { requestBody: json(ref("SecurityMetadata")) }),
    },
    "/api/securities/classify": {
      post: op("Securities", "Bulk-classify securities from a reference CSV", { requestBody: json(ref("ClassifyInput")), responses: { "200": { description: "How many were updated", ...json({ type: "object", properties: { updated: { type: "integer" }, notFound: { type: "array", items: { type: "string" } }, notFoundCount: { type: "integer" } } }) }, ...AUTH_ERRORS } }),
    },

    "/api/transactions": {
      get: op("Transactions", "List/filter the ledger", { parameters: [portfolioIdParam, { name: "accountId", in: "query", schema: { type: "string" } }, { name: "securityId", in: "query", schema: { type: "string" } }, { name: "type", in: "query", schema: ref("TxType") }, { name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }, { name: "limit", in: "query", schema: { type: "integer", default: 100, maximum: 500 } }, { name: "offset", in: "query", schema: { type: "integer", default: 0 } }], responses: { "200": { description: "Transactions page", ...json({ type: "object", properties: { transactions: { type: "array", items: ref("Transaction") }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } } }) }, ...AUTH_ERRORS } }),
      post: op("Transactions", "Add a transaction (foreign trades capture FX-at-cost)", { requestBody: json(ref("TransactionInput")), responses: { "201": { description: "Created", ...json(ref("TransactionWrap")) }, ...AUTH_ERRORS } }),
    },
    "/api/transactions/{id}": {
      parameters: [idPath],
      get: op("Transactions", "Get a transaction"),
      put: op("Transactions", "Update a transaction", { requestBody: json(ref("TransactionInput")) }),
      delete: op("Transactions", "Delete a transaction", { responses: { "200": { description: "Deleted", ...json(ref("Ok")) }, ...AUTH_ERRORS } }),
    },

    "/api/holdings": {
      get: op("Holdings", "Derived holdings, allocation, base-currency summary & FX impact", { parameters: [portfolioIdParam], responses: { "200": { description: "Holdings response", ...json(ref("HoldingsResponse")) }, ...AUTH_ERRORS } }),
    },

    "/api/imports/brokers": { get: op("Imports", "List supported broker adapters") },
    "/api/imports/check": { post: op("Imports", "Preview an import (valid/invalid/duplicate counts)", { requestBody: json(ref("ImportInput")), responses: { "200": { description: "Preview", ...json(ref("ImportPreview")) }, ...AUTH_ERRORS } }) },
    "/api/imports/commit": { post: op("Imports", "Commit an import (idempotent dedup)", { requestBody: json(ref("ImportInput")), responses: { "201": { description: "Committed", ...json(ref("ImportResult")) }, ...AUTH_ERRORS } }) },
    "/api/imports/seed-prices": { post: op("Imports", "Seed current prices from a holdings snapshot (no cost basis)", { requestBody: json(ref("SeedPricesInput")), responses: { "200": { description: "Seeded", ...json(ref("SeedPricesResult")) }, ...AUTH_ERRORS } }) },
    "/api/imports": { get: op("Imports", "List import batches") },
    "/api/imports/{id}": { parameters: [idPath], get: op("Imports", "Get an import batch") },

    "/api/market-data/refresh": { post: op("Market data", "Refresh quotes for held securities (only public tickers sent)", { requestBody: json({ type: "object", properties: { portfolioId: { type: "string" } } }), responses: { "200": { description: "Refresh result", ...json({ type: "object", properties: { requested: { type: "integer" }, updated: { type: "integer" }, failed: { type: "integer" }, provider: { type: "string" }, asOf: { type: "string" } } }) }, ...AUTH_ERRORS } }) },
    "/api/market-data/status": { get: op("Market data", "Last price refresh time", { parameters: [portfolioIdParam] }) },

    "/api/exchange-rates": {
      get: op("Exchange rates", "Latest rate per currency pair"),
      put: op("Exchange rates", "Set a manual rate", { requestBody: json(ref("RateInput")), responses: { "200": { description: "Saved", ...json(ref("Ok")) }, ...AUTH_ERRORS } }),
    },
    "/api/exchange-rates/refresh": { post: op("Exchange rates", "Refresh rates for held foreign currencies", { responses: { "200": { description: "Refresh result", ...json({ type: "object", properties: { base: { type: "string" }, requested: { type: "integer" }, updated: { type: "integer" }, failed: { type: "integer" } } }) }, ...AUTH_ERRORS } }) },
    "/api/exchange-rates/backfill": { post: op("Exchange rates", "Backfill FX-at-cost on foreign trades (for return decomposition)", { responses: { "200": { description: "Backfill result", ...json({ type: "object", properties: { scanned: { type: "integer" }, updated: { type: "integer" } } }) }, ...AUTH_ERRORS } }) },

    "/api/performance/summary": { get: op("Performance", "Realised P&L (FY/month/segment), dividends, XIRR", { parameters: [portfolioIdParam] }) },
    "/api/performance/benchmarks": { get: op("Performance", "Available benchmarks") },
    "/api/performance/benchmark": { get: op("Performance", "Compare portfolio vs an index on identical cashflows", { parameters: [portfolioIdParam, { name: "benchmark", in: "query", required: true, description: "Benchmark id (e.g. nifty50)", schema: { type: "string" } }] }) },
    "/api/performance/twr": { get: op("Performance", "Time-weighted return (price-based, single-currency holdings)", { parameters: [portfolioIdParam] }) },

    "/api/dividends": { get: op("Dividends", "Dividend & interest income by FY and security", { parameters: [portfolioIdParam] }) },

    "/api/goals": {
      get: op("Goals", "List goals with progress"),
      post: op("Goals", "Create a goal", { requestBody: json(ref("GoalInput")), responses: { "201": { description: "Created", ...json(ref("GoalWrap")) }, ...AUTH_ERRORS } }),
    },
    "/api/goals/{id}": {
      parameters: [idPath],
      get: op("Goals", "Get a goal with progress"),
      put: op("Goals", "Update a goal / its funding portfolios", { requestBody: json(ref("GoalInput")) }),
      delete: op("Goals", "Delete a goal", { responses: { "200": { description: "Deleted", ...json(ref("Ok")) }, ...AUTH_ERRORS } }),
    },

    "/api/account/export": { get: op("Account", "Export all of the caller's data as JSON", { responses: { "200": { description: "Full data export (JSON download)" }, "401": ERR("Not authenticated") } }) },
    "/api/account/delete": { post: op("Account", "Permanently delete the account (password-confirmed)", { requestBody: json({ type: "object", required: ["password"], properties: { password: { type: "string" } } }), responses: { "200": { description: "Deleted", ...json(ref("Ok")) }, "401": ERR("Wrong password / not authenticated") } }) },
  },

  components: {
    securitySchemes: { cookieAuth: { type: "apiKey", in: "cookie", name: "dd_session", description: "Session cookie set by the auth endpoints." } },
    schemas: {
      Error: { type: "object", required: ["error", "message"], properties: { error: { type: "string", description: "Machine-readable code" }, message: { type: "string" } } },
      ValidationError: { type: "object", properties: { error: { const: "validation_error" }, issues: { type: "array", items: { type: "object" } } } },
      Ok: { type: "object", properties: { ok: { const: true } } },
      Money: { type: "string", description: "Exact decimal as a string (never a float), e.g. \"1234.56\". null = unknown, never 0." },
      TxType: { type: "string", enum: ["buy", "sell", "dividend", "interest", "deposit", "withdrawal", "fee", "tax", "transfer_in", "transfer_out", "split", "bonus"] },
      Credentials: { type: "object", required: ["username", "password"], properties: { username: { type: "string", minLength: 3, maxLength: 64 }, password: { type: "string", minLength: 8 } } },
      RegisterInput: { allOf: [ref("Credentials"), { type: "object", properties: { email: { type: "string", format: "email" }, baseCurrency: { type: "string", minLength: 3, maxLength: 3 } } }] },
      User: { type: "object", properties: { id: { type: "string" }, username: { type: "string" }, email: { type: ["string", "null"] }, baseCurrency: { type: "string" } } },
      UserWrap: { type: "object", properties: { user: ref("User") } },
      Portfolio: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, description: { type: ["string", "null"] }, kind: { type: "string" }, baseCurrency: { type: "string" }, createdAt: { type: "string" } } },
      PortfolioInput: { type: "object", required: ["name"], properties: { name: { type: "string", maxLength: 120 }, description: { type: "string" }, kind: { type: "string", enum: ["broker", "group", "strategy", "geo", "goal", "family", "custom"] }, baseCurrency: { type: "string" } } },
      PortfolioWrap: { type: "object", properties: { portfolio: ref("Portfolio") } },
      AccountInput: { type: "object", required: ["portfolioId", "name"], properties: { portfolioId: { type: "string" }, name: { type: "string" }, broker: { type: "string", enum: ["zerodha", "dhan", "vested", "crypto", "generic", "manual"] }, accountRef: { type: "string" }, currency: { type: "string" } } },
      SecurityInput: { type: "object", required: ["symbol", "name"], properties: { symbol: { type: "string" }, name: { type: "string" }, isin: { type: "string", minLength: 12, maxLength: 12 }, amfiCode: { type: "string" }, assetClass: { type: "string" }, currency: { type: "string" }, exchange: { type: "string" } } },
      SecurityMetadata: { type: "object", properties: { name: { type: "string" }, assetClass: { type: "string" }, sector: { type: ["string", "null"] }, subSector: { type: ["string", "null"] }, isin: { type: ["string", "null"] }, amfiCode: { type: ["string", "null"] }, exchange: { type: ["string", "null"] } } },
      Security: { type: "object", properties: { id: { type: "string" }, symbol: { type: "string" }, name: { type: "string" }, assetClass: { type: "string" }, sector: { type: ["string", "null"] }, currency: { type: "string" }, exchange: { type: ["string", "null"] } } },
      SecurityWrap: { type: "object", properties: { security: ref("Security"), created: { type: "boolean" } } },
      ClassifyInput: { type: "object", required: ["content"], properties: { content: { type: "string", description: "Raw CSV: symbol/ticker (+ optional name, asset_class, sector, sub_sector, amfi)" } } },
      Transaction: { type: "object", properties: { id: { type: "string" }, portfolioId: { type: "string" }, securityId: { type: ["string", "null"] }, type: ref("TxType"), tradeDate: { type: "string" }, quantity: ref("Money"), price: ref("Money"), grossAmount: ref("Money"), fees: ref("Money"), taxes: ref("Money"), currency: { type: "string" }, fxRateToBase: { type: ["string", "null"] }, segment: { type: "string" }, sourceBroker: { type: ["string", "null"] } } },
      TransactionInput: { type: "object", required: ["portfolioId", "type", "tradeDate"], properties: { portfolioId: { type: "string" }, accountId: { type: ["string", "null"] }, securityId: { type: ["string", "null"] }, type: ref("TxType"), tradeDate: { type: "string", description: "Date or ISO timestamp" }, quantity: { type: "string" }, price: { type: "string", description: "For a split, this is the ratio (new shares per old share)." }, grossAmount: { type: "string" }, fees: { type: "string" }, taxes: { type: "string" }, currency: { type: "string" }, fxRateToBase: { type: "string" }, segment: { type: "string", enum: ["equity", "mf", "fno", "commodity", "other"] }, notes: { type: "string" } } },
      TransactionWrap: { type: "object", properties: { transaction: ref("Transaction") } },
      Holding: { type: "object", properties: { security: ref("Security"), netQty: ref("Money"), invested: ref("Money"), avgCost: ref("Money"), currentValue: ref("Money"), unrealisedPnl: ref("Money"), realisedPnl: ref("Money"), dividends: ref("Money"), netPnl: ref("Money"), quote: { type: ["object", "null"], properties: { price: { type: "string" }, asOf: { type: "string" } } }, baseInvested: ref("Money"), baseCurrentValue: ref("Money"), investedBaseAtCost: ref("Money"), avgFxAtCost: ref("Money"), assetReturnBase: ref("Money"), currencyReturnBase: ref("Money") } },
      HoldingsResponse: { type: "object", properties: { baseCurrency: { type: "string" }, fxComplete: { type: "boolean" }, unconvertibleCurrencies: { type: "array", items: { type: "string" } }, cashTracked: { type: "boolean", description: "True when the ledger records deposits/withdrawals; then summary.cash and summary.netWorth are meaningful." }, fxImpact: { type: ["object", "null"], properties: { assetReturn: ref("Money"), currencyReturn: ref("Money"), total: ref("Money"), decomposablePositions: { type: "integer" }, missingCostFxCurrencies: { type: "array", items: { type: "string" } } } }, summary: { type: "object", description: "invested, currentValue, unrealisedPnl, realisedPnl, dividends, netPnl, cash, netWorth, openPositions, pricedPositions, allPriced (all money as decimal strings)" }, allocation: { type: "object" }, holdings: { type: "array", items: ref("Holding") } } },
      ImportInput: { type: "object", required: ["portfolioId", "broker", "filename", "content"], properties: { portfolioId: { type: "string" }, accountId: { type: ["string", "null"] }, broker: { type: "string" }, filename: { type: "string" }, content: { type: "string", description: "Raw CSV text, or base64 when encoding is set (a .xlsx workbook or non-UTF8 CSV)" }, encoding: { type: "string", enum: ["base64"], description: "Set when content is base64 (e.g. an .xlsx upload)" }, from: { type: "string", description: "Start of the period this file covers (with replace)" }, to: { type: "string" }, replace: { type: "boolean", description: "Overwrite existing rows from this source within [from, to]" }, mapping: { type: "object", description: "Column mapping (required for the generic adapter)" } } },
      SeedPricesInput: { type: "object", required: ["content"], properties: { portfolioId: { type: ["string", "null"] }, filename: { type: "string" }, content: { type: "string", description: "A holdings snapshot (CSV, or base64 .xlsx) with a current/closing price per instrument" }, encoding: { type: "string", enum: ["base64"] } } },
      SeedPricesResult: { type: "object", properties: { rows: { type: "integer" }, seeded: { type: "integer" }, matched: { type: "array", items: { type: "string" } }, unmatched: { type: "array", items: { type: "string" } }, unmatchedCount: { type: "integer" } } },
      ImportPreview: { type: "object", properties: { broker: { type: "string" }, rowsTotal: { type: "integer" }, valid: { type: "integer" }, invalid: { type: "integer" }, duplicates: { type: "integer" }, newSecurities: { type: "integer" }, toImport: { type: "integer" } } },
      ImportResult: { allOf: [ref("ImportPreview"), { type: "object", properties: { batchId: { type: "string" }, imported: { type: "integer" } } }] },
      RateInput: { type: "object", required: ["from", "to", "rate"], properties: { from: { type: "string", minLength: 3, maxLength: 3 }, to: { type: "string", minLength: 3, maxLength: 3 }, rate: { type: "string", description: "Units of `to` per 1 `from`" } } },
      GoalInput: { type: "object", required: ["name", "targetAmount"], properties: { name: { type: "string" }, targetAmount: { type: "string" }, targetDate: { type: ["string", "null"] }, currency: { type: "string" }, portfolioIds: { type: "array", items: { type: "string" } } } },
      Goal: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, targetAmount: ref("Money"), targetDate: { type: ["string", "null"] }, funded: ref("Money"), remaining: ref("Money"), progress: ref("Money"), basis: { type: "string", enum: ["current_value", "invested"] }, reached: { type: "boolean" } } },
      GoalWrap: { type: "object", properties: { goal: ref("Goal") } },
    },
  },
} as const;

/** Lightweight discovery payload for `GET /api`. */
export function apiIndex() {
  const endpoints = Object.entries(openApiSpec.paths).flatMap(([path, methods]) =>
    Object.keys(methods)
      .filter((m) => m !== "parameters")
      .map((m) => `${m.toUpperCase()} ${path}`),
  );
  return {
    name: "Dhan Drishti API",
    version: API_VERSION,
    description: openApiSpec.info.description,
    auth: "session cookie (dd_session) via /api/auth/login or /api/auth/register",
    schema: "/api/openapi.json",
    endpoints,
  };
}
