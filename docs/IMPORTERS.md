# Dhan Drishti — Import Engine Design (Phase 1)

Broker CSV parsing is **isolated** behind one interface. Core never contains broker logic.

## The `BrokerAdapter` contract
```ts
interface BrokerAdapter {
  id: 'zerodha' | 'dhan' | 'vested' | 'ibkr' | 'binance' | 'generic';
  label: string;
  detect(file: ParsedCsv): DetectResult;          // confidence 0..1 + which sheet/format
  normalize(file: ParsedCsv, ctx: ImportContext): NormalizedRow[]; // → canonical rows
}
type NormalizedRow =
  | { ok: true;  tx: CanonicalTx; rawHash: string; externalRef?: string }
  | { ok: false; error: string; raw: Record<string,string>; rowIndex: number };
```
Adapters map columns, normalize dates/decimals/signs/buy-sell terms/currency, and resolve
security identity (symbol ↔ ISIN ↔ AMFI) via the security master, then emit canonical
transactions (see `SCHEMA.md`/`CALCULATIONS.md`).

## Pipeline (12 steps → wizard)
```
1 choose source/broker → 2 upload CSV → 3 parse (papaparse) → 4 detect format →
5 normalize → 6 validate (Zod) → 7 classify rows: valid | invalid | duplicate |
unknown-asset | missing-field → 8 preview + user resolves → 9 confirm →
10 store canonical tx (+ import_batch) → 11 recalculate holdings → 12 summary
```
Import is **idempotent**: dedup by `external_ref` (broker trade/order id) when present.
When a broker export lacks a trade id, dedup falls
back to `sha256(broker + raw row)` **plus an occurrence index within the file** — so two
genuinely-identical trades in one file are both kept, while re-uploading the same file
reproduces the same hashes and imports 0 new rows. Re-uploads are always idempotent.
*(Implemented + validated on 2019 real Zerodha rows: first import 2019, re-import 0.)*

## Zerodha (first adapter)
- Tradebook columns: `Symbol, ISIN, TradeDate, Exch, Seg, Series, TradeType(buy/sell),
  Qty, Price, Amount` → map to buy/sell canonical tx (currency INR). `NetQty`, `BuyAvg`,
  `Auction` are derived/UI — ignored on import.
- Ledger (`Particulars, Posting Date, Voucher Type, Debit, Credit, Net Balance`) →
  cash movements (deposit/withdrawal/fee) — separate importer path; ledger is the source
  of truth for cash/charges, tradebook for trades (avoid double counting).
- Dividends sheet (`Symbol, ISIN, Date, Qty, DividendPerShare, DivAmt`) → dividend tx.

## Implemented adapters
- **Zerodha** ✅ (tradebook, above).
- **Dhan** ✅ `Dhan All TradeBook` (Date+Time, Name, BuySell, Exchange, Segment, Quantity,
  TradePrice, TradeValue). Dhan keys securities by **full Name** (no ticker/ISIN in the
  export), so securities are name-based until a `Dhan Keys` / classification map bridges them.
- **Vested** ✅ US stocks (Symbol/Side/Shares/Price/Amount/Date) → USD equities; FX-at-cost is
  captured on write from the trade date, so returns decompose into asset vs currency.
- **Interactive Brokers** ✅ Flex/Activity trades — **signed quantity** (− = sell) when there is
  no Buy/Sell column, `IBCommission` → fees, `CurrencyPrimary` → currency, `AssetClass` (STK/ETF/
  CRYPTO…) → asset class, compact `YYYYMMDD` dates.
- **Binance** ✅ spot trade history — the pair (e.g. `BTCUSDT`) is split into its **base asset**
  (crypto security) priced in the **quote** currency (USDT/USDC/… → USD); UTC timestamps.
- **Generic** ✅ `makeGenericAdapter(mapping)` — the user maps CSV columns → canonical
  fields (a reusable "import template" pattern); the wizard collects the mapping before
  preview. `POST /api/imports/{check,commit}` accept an optional `mapping`. Covers any other
  broker/platform.

## Security identity resolver
Resolve order: exact symbol+exchange → ISIN → AMFI code → broker-name crosswalk
(`Dhan Keys`/`MF Keys`). Unresolved → row flagged `unknown-asset`, queued for the user to
map (never guessed silently).

## Safety
CSV only; enforce MIME + extension + size limit; parse in isolation; **never evaluate
cell formulas**; strip/parse as plain text. Portfolio data never leaves the machine.
