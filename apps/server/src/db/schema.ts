import { sqliteTable, text, integer, index, unique } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * SQLite schema (Drizzle). Money & quantities are TEXT decimal strings (never floats) —
 * computed with decimal.js in @dhan-drishti/core. Timestamps are ISO-8601 UTC text.
 * See docs/SCHEMA.md.
 */

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email"),
  phone: text("phone"),
  dob: text("dob"),
  passwordHash: text("password_hash").notNull(),
  baseCurrency: text("base_currency").notNull().default("INR"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(), // opaque random token
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("idx_sessions_user").on(t.userId)],
);

export const portfolios = sqliteTable(
  "portfolios",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    kind: text("kind").notNull().default("custom"), // broker|group|strategy|geo|goal|family|custom
    baseCurrency: text("base_currency").notNull().default("INR"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [unique("uq_portfolio_user_name").on(t.userId, t.name)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    portfolioId: text("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    broker: text("broker").notNull().default("manual"), // zerodha|dhan|vested|crypto|generic|manual
    accountRef: text("account_ref"),
    currency: text("currency").notNull().default("INR"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [index("idx_accounts_portfolio").on(t.portfolioId)],
);

export const securities = sqliteTable(
  "securities",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    isin: text("isin"),
    amfiCode: text("amfi_code"),
    name: text("name").notNull(),
    assetClass: text("asset_class").notNull().default("equity"),
    subClass: text("sub_class"),
    sector: text("sector"),
    subSector: text("sub_sector"),
    currency: text("currency").notNull().default("INR"),
    exchange: text("exchange"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    unique("uq_security_symbol_exchange").on(t.symbol, t.exchange),
    index("idx_securities_isin").on(t.isin),
    index("idx_securities_amfi").on(t.amfiCode),
  ],
);

export const importBatches = sqliteTable("import_batches", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  portfolioId: text("portfolio_id")
    .notNull()
    .references(() => portfolios.id, { onDelete: "cascade" }),
  accountId: text("account_id").references(() => accounts.id, { onDelete: "set null" }),
  broker: text("broker").notNull(),
  filename: text("filename").notNull(),
  fileHash: text("file_hash").notNull(),
  status: text("status").notNull().default("previewed"), // previewed|committed|reverted
  rowsTotal: integer("rows_total").notNull().default(0),
  rowsImported: integer("rows_imported").notNull().default(0),
  rowsSkipped: integer("rows_skipped").notNull().default(0),
  rowsInvalid: integer("rows_invalid").notNull().default(0),
  createdAt: text("created_at").notNull().default(now),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    portfolioId: text("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    accountId: text("account_id").references(() => accounts.id, { onDelete: "set null" }),
    securityId: text("security_id").references(() => securities.id, { onDelete: "restrict" }),
    importBatchId: text("import_batch_id").references(() => importBatches.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    tradeDate: text("trade_date").notNull(),
    settleDate: text("settle_date"),
    quantity: text("quantity").notNull().default("0"),
    price: text("price").notNull().default("0"),
    grossAmount: text("gross_amount").notNull().default("0"),
    fees: text("fees").notNull().default("0"),
    taxes: text("taxes").notNull().default("0"),
    currency: text("currency").notNull().default("INR"),
    fxRateToBase: text("fx_rate_to_base"),
    segment: text("segment").notNull().default("equity"),
    externalRef: text("external_ref"),
    rawRowHash: text("raw_row_hash"),
    sourceBroker: text("source_broker"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    index("idx_tx_user_portfolio").on(t.userId, t.portfolioId),
    index("idx_tx_security").on(t.securityId),
    index("idx_tx_raw_hash").on(t.rawRowHash),
    unique("uq_tx_user_extref").on(t.userId, t.externalRef),
  ],
);

export const quotes = sqliteTable(
  "quotes",
  {
    id: text("id").primaryKey(),
    securityId: text("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "cascade" }),
    price: text("price").notNull(),
    prevClose: text("prev_close"),
    changePct: text("change_pct"),
    currency: text("currency").notNull().default("INR"),
    asOf: text("as_of").notNull(),
    provider: text("provider").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("idx_quotes_security_asof").on(t.securityId, t.asOf)],
);

export const exchangeRates = sqliteTable(
  "exchange_rates",
  {
    id: text("id").primaryKey(),
    baseCurrency: text("base_currency").notNull(),
    quoteCurrency: text("quote_currency").notNull(),
    rate: text("rate").notNull(),
    asOf: text("as_of").notNull(),
    provider: text("provider").notNull(),
  },
  (t) => [unique("uq_fx").on(t.baseCurrency, t.quoteCurrency, t.asOf)],
);

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  targetAmount: text("target_amount").notNull(),
  targetDate: text("target_date"),
  currency: text("currency").notNull().default("INR"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

// Which portfolios fund a goal. No links = funded by all the user's portfolios.
export const goalPortfolios = sqliteTable(
  "goal_portfolios",
  {
    goalId: text("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    portfolioId: text("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
  },
  (t) => [unique("uq_goal_portfolio").on(t.goalId, t.portfolioId)],
);

// One net-worth data point per user per portfolio-scope per day, for the value-over-time chart.
// portfolioId NULL = the "all portfolios" aggregate. Provider "reconstructed" marks a backfilled
// historical point (valued from price history) vs a live "snapshot" recorded from actual holdings.
export const snapshots = sqliteTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    portfolioId: text("portfolio_id").references(() => portfolios.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD
    netWorth: text("net_worth").notNull(),
    holdingsValue: text("holdings_value").notNull(),
    cash: text("cash").notNull(),
    invested: text("invested").notNull(),
    currency: text("currency").notNull().default("INR"),
    provider: text("provider").notNull().default("snapshot"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [unique("uq_snapshot").on(t.userId, t.portfolioId, t.date), index("idx_snapshot_user_date").on(t.userId, t.date)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Portfolio = typeof portfolios.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Security = typeof securities.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Goal = typeof goals.$inferSelect;
