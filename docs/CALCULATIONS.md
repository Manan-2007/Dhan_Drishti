# Dhan Drishti — Calculation Methodology (Phase 1)

Every UI metric maps to one formula here. Implemented in `packages/core` as a **pure,
deterministic, unit-tested** module using `decimal.js` (no floats, no DB coupling).
Golden tests validate against the prototype's figures.

## Conventions
- Signed quantity: BUY qty > 0, SELL qty > 0 but subtracts from holdings. Internally we
  compute signed via `type`. `deposit/withdrawal/fee/tax/dividend/interest` are cash/income
  events (no share qty effect except they affect cash & P&L).
- Cost basis default: **average cost** (matches Indian brokers). FIFO/lots = post-MVP.
- All money is `Decimal`. Division guards against zero (return null, never NaN/Infinity).

## Holdings (per security, within a scope: account | portfolio | all)
```
net_qty     = Σ(buy.qty) − Σ(sell.qty)
buy_cost    = Σ(buy.qty·buy.price + buy.fees + buy.taxes)
avg_cost    = net_qty > 0 ? (remaining cost basis)/net_qty : null
invested    = net_qty · avg_cost            // capital currently deployed
```
Average-cost realised handling: on each SELL, cost removed = sell.qty · avg_cost_at_time.
Track running (qty, total_cost); avg_cost = total_cost/qty; SELL reduces both proportionally.

## Realised P&L (per sell, rolled up)
```
realised_pnl(sell) = sell.qty·sell.price − sell.qty·avg_cost_at_time − sell.fees − sell.taxes
```
Roll up by security, by month, by **FY (Apr→Mar, Indian)**, and by segment
(equity | mf | fno | commodity) — mirrors the monthly realised-P&L breakdown.

## Unrealised P&L (needs current price; else null/"—")
```
current_value  = net_qty · quote.price
unrealised_pnl = current_value − invested
unrealised_%   = invested > 0 ? unrealised_pnl / invested : null
today_change   = net_qty · (quote.price − quote.prev_close)
```

## Dividends / income
```
dividend_total(security) = Σ dividend.gross_amount
```

## Net P&L (headline)
```
net_pnl = unrealised_pnl + realised_pnl + dividends − fees − taxes
```

## Allocation
```
weight(security) = current_value(security) / Σ current_value      // price-based
// fallback when no prices: weight = invested(security) / Σ invested (clearly labelled)
```
Break down by asset_class, sector, broker, portfolio, currency.

## Net worth & base-currency aggregation (implemented)
```
net_worth = Σ over holdings [ current_value(asset ccy) · fx_rate(asset→base) ]
```
Every holding is converted into the user's **base currency** before summary/allocation
aggregation (`fx_rate` from the latest stored `exchange_rates`; base→base = 1). A holding
whose currency has **no rate** is excluded from base totals and surfaced via
`fxComplete=false` + `unconvertibleCurrencies` — never summed as if it were the base
currency. Allocation weights are computed on base-currency values so cross-currency slices
compare correctly. FX rates come from a provider abstraction (`FxProvider`; frankfurter.app
by default) or are set manually. The base-currency gain on foreign holdings is further split
into asset vs currency return — see *FX-impact decomposition* below.
*(Cash-balance tracking from the ledger: still to come.)*

## FX-impact decomposition (implemented — asset return vs currency return)
For a foreign-currency holding, the base-currency gain is split into the part driven by the
asset's own price and the part driven by the exchange rate moving since you bought:
```
fx_at_cost   = investedBaseAtCost / invested_local     // weighted-avg rate across the current buys
asset_return    = (value_local − invested_local) · fx_at_cost   // asset move, at cost-time FX
currency_return = value_local · (fx_now − fx_at_cost)            // FX move on the current value
asset_return + currency_return = value_local·fx_now − invested_local·fx_at_cost   // exact
```
`investedBaseAtCost` is accumulated in the holdings engine from each buy's `fxRateToBase` (the
rate on its trade date) and reduced proportionally on sells, so the average FX-at-cost is
preserved. It is captured automatically when a foreign trade is entered (historical rate from
the FX provider) and can be backfilled for imported trades (`POST /api/exchange-rates/backfill`).
A foreign holding whose buys have no recorded FX-at-cost is **excluded from the split and
flagged** (`missingCostFxCurrencies`), never estimated. Base-currency holdings have no currency
component. The decomposition is surfaced per holding and summed in `holdings.fxImpact`.

## Corporate actions
- **Bonus:** additional free shares — quantity increases by the bonus amount, cost basis
  unchanged, so average cost falls. (`quantity` = shares credited.)
- **Split / consolidation:** `price` carries the ratio (new shares per old share, e.g. `5` for
  a 1:5 split, `0.1` for a 10:1 consolidation). Quantity scales by the ratio; cost basis is
  unchanged, so average cost adjusts. Reverse splits use a fractional ratio.
- **Rights issue / buyback:** entered as an ordinary `buy` / `sell` at the applicable price.
- **Merger / demerger:** represented with `transfer_out` (old security) + `transfer_in` (new).
- **Dividend / interest / DRIP:** cash income events (a DRIP is a `dividend` plus a `buy`).

## Dividend & interest income
```
income_total = Σ over (dividend, interest) transactions of gross_amount  // converted to base
```
Reported in base currency with the FY (Apr→Mar) and per-security breakdown, plus the raw
event list. Income whose currency has no FX rate is excluded from base totals and flagged —
every figure traces to a real ledger entry; nothing is projected.

## Benchmark comparison (implemented — index-equivalent / PME-style mirror)
"What if the very same cashflows had gone into an index instead?" We mirror the portfolio's
own signed cashflows into a chosen index and value the result today:
```
on each ledger cashflow (amount<0 = money in, >0 = money out):
    units += −amount / index_close_as_of(date)      // buy on outflow, sell on inflow
index_value  = units · index_close_latest
index_xirr   = xirr(mirrored_flows + [today: index_value])   // identical schedule to the portfolio
```
`index_close_as_of(date)` uses the close on that day, else the most recent earlier bar
(markets shut on weekends/holidays). Cashflows that predate the available index history are
**skipped and counted** (`unmatchedFlows`), never silently priced. The comparison is honest
about currency: cashflows are in each transaction's own currency, so it is exact for a
single-currency (INR) portfolio vs an Indian index and is flagged with a `currencyNote`
otherwise. The head-to-head is only surfaced when the portfolio's own XIRR is available
(every open position priced, or nothing open) — otherwise the portfolio has no terminal
value to compare. Index history comes from a provider abstraction (`BenchmarkProvider`;
Yahoo by default); only the public index symbol + a date range are ever sent — never holdings.

## Cash balance & net worth (implemented)
The cash the portfolio holds is derived from the ledger — it is only surfaced once you record
the money you put in (a `deposit`/`withdrawal`), otherwise it isn't meaningful:
```
cash += deposit ; cash −= withdrawal
cash −= buy_cost(incl. fees/taxes) ; cash += sell_proceeds(net fees/taxes)
cash += dividend + interest ; cash −= fee + tax
net_worth = Σ holdings_current_value(base) + cash(base)
```
Cash is tracked per currency and converted to base like holdings. `net_worth` and `cash` appear
in the holdings summary with `cashTracked`, and cash is folded into the allocation (asset-class
and currency) as its own slice. Dividends and sale proceeds are **retained as cash**, so they
show up in net worth rather than vanishing.

## Time-weighted return (TWR — implemented)
TWR removes the effect of *when* money was added (which XIRR is sensitive to) by chaining each
sub-period's price growth:
```
sub-period return  R_k = value[k] / (value[k-1] + flow[k-1])   // flow = buy +cost, sell −proceeds
TWR = Π R_k − 1        annualized = (Π R_k)^(365/days) − 1
```
The portfolio is valued at every buy/sell date from **real historical daily prices** (per-security
`SecurityHistoryProvider`; Yahoo by default), plus the current value at the end. It is computed
**on demand** (only public tickers + a date range are sent, never holdings). Honest limits, all
surfaced rather than hidden: it needs **single-currency** holdings (cross-currency → unavailable,
since intra-period FX isn't stored) and **price history for every security** (mutual funds have
none → the securities are listed and TWR is marked unavailable). Dividends are income, shown
separately. **Two modes:** when the ledger records deposits/withdrawals (real cash accounting),
the portfolio value is holdings **+ cash** and only deposits/withdrawals are external flows — so
dividends and sale proceeds stay *retained* (a `cash-inclusive` TWR). Otherwise buys/sells are the
external flows and the value is holdings only. A security with a split
or bonus recorded only as an adjustment — not in the ledger — can distort TWR, because provider
history is corporate-action-adjusted while ledger cost is not; record the action for accuracy.

## Performance (data requirements)
- **XIRR / MWR:** dated signed cashflows (buys −, sells +, dividends +) + current value as
  final positive flow → solve IRR. Computable from ledger + one current price. **Implemented.**
- **TWR:** valuation at each flow date from historical prices, chained. **Implemented** (above).
- **FX impact:** decompose base-ccy return into asset return + currency return → **implemented**
  (see *FX-impact decomposition* above; needs `fxRateToBase` captured/backfilled per buy).
- **Benchmark comparison:** money-weighted portfolio return vs the same cashflows mirrored
  into an index (Nifty 50 / Sensex / Nifty Bank / Nifty IT) → **implemented** (see above).

## Honesty rules
- Metrics requiring unavailable data render as "—", never zero/fake.
- Prices are external + timestamped ("as of …"); staleness surfaced.
- Provenance preserved: source / normalized / derived / external / user.
