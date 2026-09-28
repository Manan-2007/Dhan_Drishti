# Dhan Drishti — Import Engine

Broker parsing is **isolated** behind one interface. Core never contains broker logic. Uploads may
be **CSV**, **Excel (`.xlsx`)** (read as data with SheetJS — formulas are never evaluated), or a
mutual-fund **CAS PDF** (text extracted with pdf.js, password-aware).

## The `BrokerAdapter` contract
```ts
interface BrokerAdapter {
  id: string;                                      // "zerodha" | "dhan" | "vested" | …
  label: string;
  detect(file: ParsedCsv): DetectResult;           // confidence 0..1 + reason
  normalize(file: ParsedCsv): NormalizedRow[];     // → canonical rows
}
type NormalizedRow =
  | { ok: true;  rowIndex: number; rawHash: string; tx: NormalizedTx }   // tx.externalRef?, tx.quotePrice?
  | { ok: false; rowIndex: number; error: string };
```
Adapters map columns, normalize dates / decimals / signs / buy-sell terms / currency, and resolve
security identity, then emit canonical transactions (see `SCHEMA.md` / `CALCULATIONS.md`).

## Pipeline (preview → commit)
```
choose source → upload (CSV / .xlsx / CAS PDF) → resolve rows → detect format → normalize →
validate → classify: valid | invalid | duplicate | new-security → preview → commit (atomic)
```
- The period the file covers is read from **its own transaction dates** (min/max), so you never
  type a date range. With `replace`, existing rows from the same source in that range are cleared
  first — re-uploading an overlapping file overwrites cleanly instead of duplicating.
- The whole **commit is one transaction**: the replace-delete, the batch record, and every
  security / transaction / quote insert either all apply or all roll back — never a half-import.
  Securities are resolved once each and rows are bulk-inserted.

## Drop anything (`/detect` → `/commit-many`)
The app's main import path. Each file is identified with no hints — its kind (`transactions`,
`prices`, `pnl_report`, `not_needed`, `needs_password`, `unrecognized`), broker, and the client
code printed in its preamble ("UCC, BDDA…") or its name (`tradebook-BH1234-EQ.csv`). Files sharing
a code are one account: known codes match an existing account, an account with no code yet learns
it, and only a genuinely new account asks whose it is. The whole drop commits in **one transaction**,
without period-replace (a broker's equity and F&O files cover the same dates, so replacing one's
period would delete the other's rows) — re-drops stay clean through dedup.

### Broker P&L reports as a cross-check
A realised-P&L report (Dhan's "Realised PnL Report": per instrument, the closed quantity with its
buy and sell values) is never imported as trades. It runs after the trade files, per account:
- **Missing exits.** Statements sometimes drop a closing trade (Dhan's leaves out some F&O exits),
  so a contract looks open forever. For a *derivative* still open in the ledger, if the report's
  numbers differ from the ledger's by **exactly** the open quantity — all buys closed and exactly
  the leftover more sold (or the mirror for a short), buy (sell) value matching to ₹1 — the missing
  trade is added, priced from the report and dated at expiry (never past the report's end).
  Anything less clear-cut is left alone and counted as unmatched. Contracts are matched by name,
  ticker in brackets, or (the same underlying, type and strike with expiry ≤ 3 days apart) when a
  statement and its report label an MCX expiry a day apart.
- **Totals check.** Our realised P&L for the instruments the report lists, over its period, next
  to the broker's net figure. Shares sold with no purchase in the files (bought before they start)
  are counted, since the broker knows their cost and the ledger doesn't.

## Dates
Adapters never trust the server's timezone. `canonicalDate(raw, zone)`: a date-only row (or a
printed midnight) is stored at **UTC midnight of the printed date**; a real time is read in the
broker's zone (IST for Indian brokers, UTC for Binance, New York for US brokers) and stored as the
true instant. So `tradeDate.slice(0, 10)` and the financial year are always the broker's date.
Zerodha rows use `order_execution_time` when present, so same-day trades keep their real order.

## Idempotency & dedup
Dedup by `external_ref` (broker trade/order id) when present. When an export lacks a trade id,
dedup falls back to `sha256(broker + raw row)` **plus an occurrence index within the file** — so two
genuinely-identical trades in one file are both kept, while re-uploading the same file reproduces
the same hashes and imports 0 new rows. Re-uploads are always idempotent.

## Implemented adapters

**Transactions**
- **Zerodha** — Console tradebook (Symbol, ISIN, TradeDate, Exchange, Segment, TradeType, Qty,
  Price, trade_id → buy/sell, INR).
- **Dhan** — tradebook, and an **All Transactions** report (`dhan-txn`) that carries equity, ETF and
  mutual-fund activity together. Dhan keys securities by **full name** (no ticker/ISIN in the
  export) until the built-in classifier bridges them.
- **Vested** — US stocks (Symbol/Side/Shares/Price/Amount/Date) → USD equities; FX-at-cost is
  captured from the trade date so returns decompose into asset vs currency.
- **Interactive Brokers** — Flex/Activity trades with **signed quantity** (− = sell), `IBCommission`
  → fees, `CurrencyPrimary` → currency, `AssetClass` (STK/ETF/CRYPTO…) → asset class.
- **Binance** — spot trade history; the pair (`BTCUSDT`) splits into its **base asset** priced in the
  **quote** currency (USDT/USDC/… → USD).
- **Funds** & **Dividends** — a broker ledger's deposits/withdrawals, and a dividend/interest payout
  statement.

**Holdings statements** (**Holdings** generic, **Zerodha holdings** `.xlsx`): what an account held on
a day, stored in `holding_snapshots` — never added on top of the trades, which would count every
share a tradebook already bought twice. The ledger gets only the difference, re-derived from the
account's latest statement whenever its trades change, so files can arrive in any order:
- more held than the trades explain → an **opening balance** dated the day before the trade history
  starts, at the broker's average price (compared against the raw buys − sells, so it also covers
  sales of shares bought before the history);
- fewer → a **transfer out** on the statement date, at cost (no invented profit);
- positions the trades show but the statement doesn't list are reported, not removed — a statement
  can be one sheet of a workbook. Re-importing the same statement changes nothing.
These derived rows (`source_broker = 'snapshot'`) can't be edited by hand. Statements imported
before this existed (as buys) are converted once at startup.

**Price seed** (kind `prices` — current value without cost basis): **Dhan holdings**.

**Mutual-fund CAS PDF** (`cas`) — one password-protected CAMS / KFintech Consolidated Account
Statement covers every AMC. The text is extracted (password usually the PAN), then each scheme's
rows are read: purchases / SIPs / switch-ins / STP-in / IDCW reinvest → buy, redemptions /
switch-outs / SWP → sell, IDCW payouts → dividend; stamp-duty / STT / TDS rows are skipped. The
reader keys off the leading date and the trailing numeric columns and classifies by the sign of the
units, so it tolerates the real-world variety across RTAs and years.

**Generic** — `makeGenericAdapter(mapping)`; the user maps CSV columns → canonical fields. The
wizard collects the mapping before preview. `POST /api/imports/{check,commit}` accept a `mapping`.

## Security identity resolver
Before that, an Indian share, ETF or REIT/InvIT that arrives worded ("POWER FINANCE CORPORATION",
Dhan) or as a ticker without an ISIN is resolved to its **NSE listing** (`import/listings.ts`,
offline, from the bundled master `nse-master-data.json` — regenerate with
`scripts/build-nse-master.mjs`): by ISIN, then a ticker in brackets, then the name, where every word
of the broker's name must be found in the listing's (shortened words and initials allowed — "MNGT
SER", "MQ") and only one best listing is accepted. So "KOTAK BANK", "KOTAK MAHINDRA BANK LTD" and
Zerodha's KOTAKBANK are one security, priced and classified. Ambiguous names stay as they are.
Securities created before this existed are matched and merged once at startup (every row moves;
nothing is dropped). Then find-or-create resolves in order: **ISIN → symbol + exchange → symbol**. A newly-imported security
is then auto-classified (sector / sub-sector / asset class) from a bundled NSE/AMFI reference and
segment-aware rules (F&O → Derivatives). Nothing is guessed silently — unresolved metadata stays
blank rather than fabricated.

## Safety
Enforce extension + size limit; parse in isolation; **never evaluate spreadsheet formulas** (cells
read as text); a CAS PDF is read for text only. Portfolio data never leaves the machine.
