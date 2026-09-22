# Dhan Drishti — Calculation Methodology

Every UI metric maps to one formula here. Implemented in `packages/core` as **pure,
deterministic, unit-tested** modules using `decimal.js` (no floats, no DB coupling).

## Conventions
- Signed quantity: BUY qty > 0, SELL qty > 0 but subtracts from holdings. Internally we
  compute signed via `type`. `deposit/withdrawal/fee/tax/dividend/interest` are cash/income
  events (no share qty effect except they affect cash & P&L).
- Cost basis for **holdings & analytics is average cost** (matches Indian brokers). The
  **capital-gains report uses FIFO** — the tax method — in a separate pass (see below).
- All money is `Decimal`. Division guards against zero (return null, never NaN/Infinity).
- **Caching:** derived holdings are cached per (user, scope) and invalidated on any write, so a
  page firing several holdings-derived endpoints recomputes the portfolio once, not once each.

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
Broken down by **asset class, sector, sub-sector, region and currency**. Cash and manual assets
(FDs, gold, real estate…) fold in as their own slices. A security's **region** is inferred from its
currency (INR → India, USD → United States, …); manual assets carry their own region. Weights are
computed on base-currency values so cross-currency slices compare correctly.

## Diversification / concentration (implemented)
A purely-derived read on how spread-out the invested money is:
```
w_i     = position_value_i / Σ position_value        // over priced positions (cash excluded)
HHI     = Σ w_i²          effective_holdings = 1 / HHI
score   = round( 100 · [ 0.6·(1 − HHI) + 0.4·(1 − HHI_sector) ] )   // 0..100, higher = better
```
Also surfaced: the largest single-position weight, the top-5 weight, the biggest sector weight, and
plain-language flags for single-stock and sector concentration. Every input is a real position value.

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
into asset vs currency return — see *FX-impact decomposition* below. Cash (from the ledger) and
**manual assets** are added on top — see *Cash balance & net worth* and *Manual (non-market) assets*.

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
event list. Income whose currency has no FX rate is excluded from base totals and flagged.

**Trailing yield & an estimated calendar.** The trailing-12-month income and the yield (that income
over the current value of held payers) are **real sums**. A per-payer calendar then infers a
**cadence** (median gap between historical payouts → ~monthly/quarterly/annual) and a **next expected
date** (last payout + median, rolled forward) — these are **estimates, clearly labelled**, dropped
once a payer goes quiet (older than ~2 cycles). Real income vs estimated dates are never conflated.

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

The comparison is also drawn as an **overlay chart**: sampled month by month, the cumulative net
cash contributed vs the value of the index units those same flows would have bought at each date's
close. The final gap equals the benchmark edge reported above. It renders even when the head-to-head
XIRR isn't available (it needs only index bars + cashflows, not current portfolio prices).

## FIFO capital gains (implemented — for ITR; not tax advice)
Separate from the average-cost engine, the tax report matches each sale against the **oldest open
lots (FIFO)** and classifies by holding period:
```
per sale, consume lots oldest-first:
  proceeds = qty·sell_price − pro-rata(sell fees+taxes)
  cost     = qty·lot_cost_per_unit          // buy fees/taxes folded into the lot
  gain     = proceeds − cost
  term     = holding_days > long_term_threshold(asset_class) ? "long" : "short"
```
Buys/transfers-in open lots; bonuses add zero-cost lots; splits scale lots (basis & date unchanged);
**F&O is excluded** (business income, not capital gains). Grouped by financial year into STCG/LTCG
totals, exportable as CSV. Long-term thresholds (12 months for listed equity & equity MFs, 24 months
otherwise) are a starting point — the report is informational and the user confirms current rules.

## Cash balance & net worth (implemented)
The cash the portfolio holds is derived from the ledger — it is only surfaced once you record
the money you put in (a `deposit`/`withdrawal`), otherwise it isn't meaningful:
```
cash += deposit ; cash −= withdrawal
cash −= buy_cost(incl. fees/taxes) ; cash += sell_proceeds(net fees/taxes)
cash += dividend + interest ; cash −= fee + tax
net_worth = Σ holdings_current_value(base) + cash(base) + Σ manual_asset_value(base)
```
Cash is tracked per currency and converted to base like holdings. `net_worth`, `cash` and
`manualAssets` appear in the holdings summary with `cashTracked`, and both cash and manual assets
fold into the allocation as their own slices. Dividends and sale proceeds are **retained as cash**,
so they show up in net worth rather than vanishing.

## Manual (non-market) assets (implemented)
Assets with no market price — FDs, PPF/EPF/NPS, physical gold, real estate, savings, bonds — carry a
**value the user maintains by hand** (with an optional cost → a gain figure). They never touch the
ledger, but their base-currency value is added to `net_worth` and folded into the by-asset-class and
by-region allocation (and therefore into rebalancing). Nothing is estimated; every figure is entered.

## Net worth over time (implemented)
A daily net-worth point is recorded per scope (portfolio, or the "all portfolios" aggregate) —
forward-accruing: on the first holdings view of the day, on login, and by the nightly cron. The
chart and the windowed change (1M/3M/6M/1Y/Max) read this `snapshots` series; there is no historical
back-fill, so the trend builds from first use.

## Rebalancing / target allocation (implemented)
Compares user-set **target weights** (per asset class or sector) against the live allocation:
```
drift_weight(key) = current_weight(key) − target_weight(key)          // + = over target
drift_value(key)  = current_value(key)  − target_weight(key)·total     // + = trim, − = add
```
Targets are the user's own choice; current weights and rupee drift come straight from priced
holdings. Target weights can't exceed 100%.

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
