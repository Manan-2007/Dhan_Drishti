# Dhan Drishti — Database Schema (Phase 1)

Store: **SQLite** (via Drizzle ORM, dialect-swappable to Postgres). One language/ORM,
zero infra for local-first self-hosting.

## Money & number rules (non-negotiable)
- **No floats for money.** Monetary amounts stored as **TEXT decimal strings** and
  computed with `decimal.js`. Quantities also TEXT decimal (fractional shares/MF units).
- All timestamps stored **UTC ISO-8601**; trade dates carry an original timezone note.
- Every user-owned row carries `user_id`; every query is scoped by it (isolation).

## Tables

### users
`id (pk), username (unique), email, phone?, dob?, password_hash, password_salt?,
base_currency (default 'INR'), created_at, updated_at`

### portfolios
`id (pk), user_id (fk→users, cascade), name, description?, kind (broker|group|strategy|
geo|goal|family|custom), base_currency, created_at, updated_at` · unique(user_id, name)

### accounts  (optional broker/platform account inside a portfolio)
`id (pk), user_id (fk), portfolio_id (fk→portfolios, cascade), name, broker (zerodha|dhan|
vested|crypto|generic|manual), account_ref?, currency, created_at, updated_at`

### securities  (the security master; shared reference data)
`id (pk), symbol, isin?, amfi_code?, name, asset_class (equity|etf|mf|bond|reit_invit|sgb|
crypto|cash|other), sub_class?, sector?, sub_sector?, currency, exchange?, created_at,
updated_at` · unique(symbol, exchange) ; index(isin), index(amfi_code)

### transactions  (the immutable canonical ledger — source of truth)
`id (pk), user_id (fk), portfolio_id (fk), account_id? (fk), security_id? (fk; null=pure
cash), import_batch_id? (fk),
 type (buy|sell|dividend|interest|deposit|withdrawal|fee|tax|transfer_in|transfer_out|
       split|bonus),
 trade_date, settle_date?, quantity (text decimal, signed by convention), price (text),
 gross_amount (text), fees (text default '0'), taxes (text default '0'),
 currency, fx_rate_to_base? (text),
 external_ref?, raw_row_hash?, source_broker?, notes?, created_at`
Indexes: (user_id, portfolio_id), (security_id), unique(user_id, external_ref) where set,
index(raw_row_hash) for dedup.

### import_batches  (provenance for every import)
`id (pk), user_id (fk), portfolio_id (fk), account_id? (fk), broker, filename, file_hash,
status (previewed|committed|reverted), rows_total, rows_imported, rows_skipped,
rows_invalid, created_at`

### import_templates  (user column-mapping templates for generic/custom CSVs)
`id (pk), user_id (fk), name, broker?, mapping_json, created_at, updated_at`

### quotes  (external market data — cached, timestamped; NOT truth)
`id (pk), security_id (fk), price (text), prev_close? (text), change_pct? (text),
 currency, as_of, provider, created_at` · index(security_id, as_of)

### price_history  (post-MVP; for TWR/valuation series)
`id (pk), security_id (fk), date, close (text), currency, provider`

### exchange_rates  (FX; explicit + dated)
`id (pk), base_currency, quote_currency, rate (text), as_of, provider` ·
unique(base_currency, quote_currency, as_of)

### goals  (post-MVP)
`id (pk), user_id (fk), name, target_amount (text), target_date?, currency, created_at`

### benchmarks  (post-MVP)
`id (pk), symbol, name, provider` + `benchmark_history(benchmark_id, date, close)`

## Derived (NOT tables — computed by the calc engine / query layer)
- **Holdings** per (scope, security): net_qty, invested, avg_cost, current_value,
  unrealised_pnl, dividends, realised_pnl, weight%.
- **Portfolio/net-worth aggregates**, allocation breakdowns, realised-P&L rollups
  (monthly / FY / segment), performance snapshots.

See `CALCULATIONS.md` for formulas and `IMPORTERS.md` for the normalization contract.
