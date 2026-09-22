# Dhan Drishti — Database Schema

Store: **SQLite** (via Drizzle ORM + libsql, dialect-swappable to Postgres). One language/ORM,
zero infra for local-first self-hosting. Migrations live in `apps/server/drizzle/` and run on boot.
The connection enables **foreign keys**, **WAL** journaling and a **busy_timeout** so the background
scheduler's writer and request reads don't block each other.

## Money & number rules (non-negotiable)
- **No floats for money.** Monetary amounts stored as **TEXT decimal strings** and
  computed with `decimal.js`. Quantities are also TEXT decimal (fractional shares / MF units).
- All timestamps stored **UTC ISO-8601**; snapshot rows key their day as `YYYY-MM-DD`.
- Every user-owned row carries `user_id`; every query is scoped by it (isolation).

## Tables

### users
`id (pk), username (unique), email?, phone?, dob?, password_hash, base_currency (default 'INR'),
created_at, updated_at` — argon2id embeds its own salt in `password_hash`.

### sessions
`id (pk, opaque random token), user_id (fk→users, cascade), expires_at, created_at` ·
index(user_id). Expired rows are swept by the background maintenance pass.

### portfolios
`id (pk), user_id (fk→users, cascade), name, description?, kind (broker|group|strategy|
geo|goal|family|custom), base_currency, created_at, updated_at` · unique(user_id, name)

### accounts  (optional broker/platform account inside a portfolio)
`id (pk), user_id (fk), portfolio_id (fk→portfolios, cascade), name, broker (zerodha|dhan|
vested|crypto|generic|manual), account_ref?, currency, created_at, updated_at` ·
index(portfolio_id)

### securities  (the security master; shared reference data)
`id (pk), symbol, isin?, amfi_code?, name, asset_class (equity|etf|mf|bond|reit_invit|sgb|
crypto|cash|other), sub_class?, sector?, sub_sector?, currency, exchange?, created_at,
updated_at` · unique(symbol, exchange) ; index(isin), index(amfi_code)

### transactions  (the canonical ledger — source of truth)
`id (pk), user_id (fk), portfolio_id (fk), account_id? (fk, set null), security_id? (fk,
restrict; null = pure cash), import_batch_id? (fk, set null),
 type (buy|sell|dividend|interest|deposit|withdrawal|fee|tax|transfer_in|transfer_out|
       split|bonus),
 trade_date, settle_date?, quantity (text decimal), price (text), gross_amount (text),
 fees (text default '0'), taxes (text default '0'), currency, fx_rate_to_base? (text),
 segment (equity|mf|fno|commodity|other), external_ref?, raw_row_hash?, source_broker?, notes?,
 created_at`
Indexes: (user_id, portfolio_id), (security_id), (raw_row_hash) for dedup, unique(user_id,
external_ref) when set.

### import_batches  (provenance for every import)
`id (pk), user_id (fk), portfolio_id (fk), account_id? (fk, set null), broker, filename,
file_hash, status (previewed|committed|reverted), rows_total, rows_imported, rows_skipped,
rows_invalid, created_at`

### quotes  (external market data — cached, timestamped; NOT truth)
`id (pk), security_id (fk, cascade), price (text), prev_close? (text), change_pct? (text),
 currency, as_of, provider, created_at` · index(security_id, as_of).
Only the **newest quote per security** is retained — a refresh prunes older rows (net-worth
history lives in `snapshots`, not here).

### exchange_rates  (FX; explicit + dated)
`id (pk), base_currency, quote_currency, rate (text), as_of, provider` ·
unique(base_currency, quote_currency, as_of)

### snapshots  (net-worth-over-time; one point per scope per day)
`id (pk), user_id (fk, cascade), portfolio_id? (fk, cascade; NULL = the "all portfolios"
aggregate), date (YYYY-MM-DD), net_worth, holdings_value, cash, manual_assets (default '0'),
invested, currency (default 'INR'), provider (default 'snapshot'), created_at` ·
unique(user_id, portfolio_id, date), index(user_id, date). Written forward-accruing: on the first
holdings view of the day, on login, and by the nightly cron.

### allocation_targets  (rebalancing targets)
`id (pk), user_id (fk, cascade), portfolio_id? (fk, cascade; NULL = aggregate scope),
dimension (asset_class|sector), key, target_weight (text, 0..1), created_at, updated_at` ·
index(user_id, portfolio_id, dimension). Writes replace the whole (scope, dimension) set.

### manual_assets  (non-market assets that fold into net worth)
`id (pk), user_id (fk, cascade), portfolio_id? (fk, set null; NULL = unassigned/aggregate only),
name, asset_class (fd|ppf|epf|nps|savings|gold|real_estate|bond|other), region (default 'India'),
currency, current_value (text), cost? (text), notes?, value_as_of? (YYYY-MM-DD), created_at,
updated_at` · index(user_id). Values are user-maintained; they never touch the ledger.

## Derived (NOT tables — computed by the calc engine / query layer)
- **Holdings** per (scope, security): net_qty, invested, avg_cost, current_value,
  unrealised_pnl, realised_pnl, dividends, weight%, plus base-currency conversions and the
  FX-impact split. Cached per (user, scope), invalidated on any write (see `CALCULATIONS.md`).
- **Diversification / concentration** read over priced positions.
- **Portfolio / net-worth aggregates**, allocation breakdowns (asset class, sector, sub-sector,
  region, currency), realised-P&L rollups (month / FY / segment), XIRR, TWR, benchmark mirror,
  dividend income & trailing yield, and FIFO capital gains.

See `CALCULATIONS.md` for formulas and `IMPORTERS.md` for the normalization contract.
