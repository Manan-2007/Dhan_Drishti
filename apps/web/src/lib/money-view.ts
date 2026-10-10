import { useAuth } from "@/auth/AuthContext";
import { useFilter } from "@/lib/hooks";
import { num } from "@/lib/format";
import type { HoldingRow } from "@/lib/api";

/** A holding's figures in the currency being shown, plus which one that is. */
export interface HoldingView {
  cur: string;
  /** Shown in the base currency instead of its own. */
  converted: boolean;
  price: number | null;
  avgCost: number | null;
  invested: number | null;
  value: number | null;
  pnl: number | null;
  pnlPct: number | null;
  today: number | null;
  realised: number | null;
  dividends: number | null;
}

/**
 * The "US in ₹" switch, applied. A foreign holding stays in its own currency unless the switch is
 * on; then what it's worth (price, value, today's move) is at today's rate, and what went in or came
 * out (cost, booked profit, dividends) is at the rate on its own day — so the rupee gain includes
 * the currency's move. The server works those out; nothing here is a guess.
 */
export function useMoneyView() {
  const { user } = useAuth();
  const { usInBase } = useFilter();
  const base = user?.baseCurrency ?? "INR";

  const holding = (h: HoldingRow): HoldingView => {
    const short = Number(h.netQty) < 0;
    const fx = num(h.fxRate);
    if (!usInBase || h.security.currency === base || fx === null) {
      return {
        cur: h.security.currency,
        converted: false,
        price: num(h.quote?.price),
        avgCost: num(h.avgCost),
        invested: num(short ? h.shortProceeds : h.invested),
        value: num(h.currentValue),
        pnl: num(h.unrealisedPnl),
        pnlPct: num(h.unrealisedPct),
        today: num(h.todayChange),
        realised: num(h.realisedPnl),
        dividends: num(h.dividends),
      };
    }
    const costFx = num(h.avgFxAtCost) ?? fx;
    const times = (v: string | null | undefined, k: number) => (num(v) === null ? null : num(v)! * k);
    const invested = short ? times(h.shortProceeds, fx) : num(h.baseInvested);
    const pnl = num(h.baseUnrealisedPnl);
    return {
      cur: base,
      converted: true,
      price: times(h.quote?.price, fx),
      avgCost: times(h.avgCost, costFx),
      invested,
      value: num(h.baseCurrentValue),
      pnl,
      pnlPct: pnl !== null && invested ? pnl / Math.abs(invested) : num(h.unrealisedPct),
      today: times(h.todayChange, fx),
      realised: num(h.baseRealisedPnl),
      dividends: num(h.baseDividends),
    };
  };

  /** A trade, dividend or transfer: at the rate on its own day, when the ledger has it. */
  const tx = (t: { currency: string; fxRateToBase: string | null }): { cur: string; k: number; converted: boolean } => {
    const fx = num(t.fxRateToBase);
    return usInBase && t.currency !== base && fx !== null ? { cur: base, k: fx, converted: true } : { cur: t.currency, k: 1, converted: false };
  };

  /** A plain price in `currency` at today's `fxRate` (e.g. a quote or a 52-week high). */
  const price = (v: number | string | null | undefined, currency: string, fxRate: string | null | undefined): { v: number | null; cur: string } => {
    const fx = num(fxRate);
    const n = num(v);
    return usInBase && currency !== base && fx !== null && n !== null ? { v: n * fx, cur: base } : { v: n, cur: currency };
  };

  return { base, on: usInBase, holding, tx, price };
}
