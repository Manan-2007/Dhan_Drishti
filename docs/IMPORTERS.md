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

**Holdings / price-seed** (kind `prices` — seeds current value without cost basis, or imports a
holdings snapshot as buys): **Holdings** (generic), **Zerodha holdings** (`.xlsx`), **Dhan holdings**.

**Mutual-fund CAS PDF** (`cas`) — one password-protected CAMS / KFintech Consolidated Account
Statement covers every AMC. The text is extracted (password usually the PAN), then each scheme's
rows are read: purchases / SIPs / switch-ins / STP-in / IDCW reinvest → buy, redemptions /
switch-outs / SWP → sell, IDCW payouts → dividend; stamp-duty / STT / TDS rows are skipped. The
reader keys off the leading date and the trailing numeric columns and classifies by the sign of the
units, so it tolerates the real-world variety across RTAs and years.

**Generic** — `makeGenericAdapter(mapping)`; the user maps CSV columns → canonical fields. The
wizard collects the mapping before preview. `POST /api/imports/{check,commit}` accept a `mapping`.

## Security identity resolver
Find-or-create resolves in order: **ISIN → symbol + exchange → symbol**. A newly-imported security
is then auto-classified (sector / sub-sector / asset class) from a bundled NSE/AMFI reference and
segment-aware rules (F&O → Derivatives). Nothing is guessed silently — unresolved metadata stays
blank rather than fabricated.

## Safety
Enforce extension + size limit; parse in isolation; **never evaluate spreadsheet formulas** (cells
read as text); a CAS PDF is read for text only. Portfolio data never leaves the machine.
