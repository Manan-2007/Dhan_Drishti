import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeftRight, ArrowRight, ChartCandlestick, Globe, Loader2, LogOut, Newspaper, RefreshCw, Upload } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useAuth } from "@/auth/AuthContext";
import { useFilter, useHoldings, useTickerSearch } from "@/lib/hooks";
import { useRefreshPrices } from "@/lib/prices";
import { compactMoney, num, signedMoney, signedPct } from "@/lib/format";
import { stockHref } from "@/components/StockLinks";
import type { HoldingRow } from "@/lib/api";
import { cn } from "@/lib/utils";
import { JUMP_TARGETS } from "./nav";

const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);
/** Every typed word appears somewhere in the text. */
const matches = (text: string, q: string) => {
  const t = text.toLowerCase();
  return words(q).every((w) => t.includes(w));
};
const stockText = (h: HoldingRow) => `${h.security.symbol} ${h.security.name}`;
/** Exact symbol first, then symbol prefix, then the rest by size. */
const rank = (h: HoldingRow, q: string) => {
  const s = h.security.symbol.toLowerCase();
  const n = q.trim().toLowerCase();
  return s === n ? 0 : s.startsWith(n) ? 1 : 2;
};

/**
 * ⌘K, the search in the top bar. Type a stock and it answers from what you own first — its value and
 * return, with its research, news and trades a key away — then stocks you've sold, then any other
 * listed stock (public data, opened in Research). Pages and actions are here too.
 */
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { scope } = useFilter();
  const { data } = useHoldings(scope);
  const refresh = useRefreshPrices();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!open) {
      setQ("");
      setDq("");
    }
  }, [open]);
  const publicHits = useTickerSearch(dq);
  const ccy = data?.baseCurrency ?? "INR";

  const all = data?.holdings ?? [];
  const typed = q.trim();
  const { held, closed } = useMemo(() => {
    const byValue = (a: HoldingRow, b: HoldingRow) => Number(b.baseCurrentValue ?? 0) - Number(a.baseCurrentValue ?? 0);
    const openPos = all.filter((h) => Number(h.netQty) !== 0);
    if (!typed) return { held: [...openPos].sort(byValue).slice(0, 8), closed: [] as HoldingRow[] };
    const pick = (list: HoldingRow[]) => list.filter((h) => matches(stockText(h), typed)).sort((a, b) => rank(a, typed) - rank(b, typed) || byValue(a, b));
    return { held: pick(openPos).slice(0, 6), closed: pick(all.filter((h) => Number(h.netQty) === 0)).slice(0, 4) };
  }, [all, typed]);
  const top = typed ? held[0] : undefined;
  const known = new Set(all.map((h) => h.security.id));
  const others = typed.length >= 2 && dq === typed ? (publicHits.data?.results ?? []).filter((h) => !h.securityId || !known.has(h.securityId)).slice(0, 6) : [];
  const searching = typed.length >= 2 && (dq !== typed || publicHits.isFetching);
  const pages = typed ? JUMP_TARGETS.filter((t) => matches(`${t.label} ${t.keywords}`, typed)) : JUMP_TARGETS;
  const actions = [
    { key: "add", label: "Add data", hint: "Import files", text: "add data import upload files", icon: <Upload />, run: () => navigate("/accounts") },
    {
      key: "refresh",
      label: "Refresh prices",
      text: "refresh prices quotes update",
      icon: <RefreshCw />,
      run: () =>
        toast.promise(refresh.mutateAsync(), {
          loading: "Refreshing prices…",
          success: (r) => `Priced ${r.updated} of ${r.requested}${r.failed ? ` · ${r.failed} without a price` : ""}`,
          error: "Couldn't refresh prices",
        }),
    },
  ].filter((a) => !typed || matches(`${a.label} ${a.text}`, typed));

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };
  // Keep a result highlighted as the lists change (results arrive after typing), so Enter opens it.
  const first = held[0]
    ? `held ${held[0].security.id}`
    : closed[0]
      ? `closed ${closed[0].security.id}`
      : others[0]
        ? `ticker ${others[0].ticker}`
        : actions[0]
          ? `action ${actions[0].key}`
          : pages[0]
            ? `page ${pages[0].to}`
            : "";
  const [selected, setSelected] = useState("");
  useEffect(() => setSelected(first), [first]);
  const nothing = typed && !held.length && !closed.length && !others.length && !pages.length && !actions.length && !searching;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false} selected={selected} onSelectedChange={setSelected} title="Search Dhan Drishti" description="Search a stock, a page, or an action">
      <CommandInput value={q} onValueChange={setQ} placeholder="Search a stock, a page, or an action…" />
      <CommandList>
        {nothing && <CommandEmpty>Nothing matches that — not in your portfolio, the pages, or listed stocks.</CommandEmpty>}

        {held.length > 0 && (
          <CommandGroup heading={typed ? "In your portfolio" : "Your biggest holdings"}>
            {held.map((h) => (
              <CommandItem key={h.security.id} value={`held ${h.security.id}`} onSelect={() => run(() => navigate(stockHref.holding(h.security.id)))}>
                <StockLine h={h} ccy={ccy} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {top && (
          <CommandGroup heading={`${top.security.symbol} elsewhere`}>
            <CommandItem value={`research ${top.security.id}`} onSelect={() => run(() => navigate(stockHref.research(top.security.id)))}>
              <ChartCandlestick /> Research {top.security.symbol}
              <CommandShortcut>chart · technicals · fundamentals</CommandShortcut>
            </CommandItem>
            {top.security.assetClass === "equity" && (
              <CommandItem value={`news ${top.security.id}`} onSelect={() => run(() => navigate(stockHref.news(top.security.id)))}>
                <Newspaper /> News on {top.security.symbol}
              </CommandItem>
            )}
            <CommandItem value={`trades ${top.security.id}`} onSelect={() => run(() => navigate(stockHref.trades(top.security.id)))}>
              <ArrowLeftRight /> Your trades in {top.security.symbol}
            </CommandItem>
          </CommandGroup>
        )}

        {closed.length > 0 && (
          <CommandGroup heading="Sold — no longer held">
            {closed.map((h) => (
              <CommandItem key={h.security.id} value={`closed ${h.security.id}`} onSelect={() => run(() => navigate(stockHref.holding(h.security.id)))}>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{h.security.symbol}</span>
                  {h.security.name !== h.security.symbol && <span className="ml-2 text-muted-foreground">{h.security.name}</span>}
                </span>
                {num(h.baseRealisedPnl) !== null && (
                  <span className={cn("shrink-0 text-xs tabular-nums", Number(h.baseRealisedPnl) >= 0 ? "text-gain" : "text-loss")}>{signedMoney(h.baseRealisedPnl, ccy)} booked</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {typed.length >= 2 && (others.length > 0 || searching) && (
          <CommandGroup heading="Other stocks — open in Research">
            {others.map((h) => (
              <CommandItem
                key={h.ticker}
                value={`ticker ${h.ticker}`}
                onSelect={() => run(() => navigate(h.securityId ? stockHref.research(h.securityId) : `/research/t/${encodeURIComponent(h.ticker)}`))}
              >
                <Globe />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{h.ticker.replace(/\.(NS|BO)$/, "")}</span>
                  <span className="ml-2 text-muted-foreground">{h.name}</span>
                </span>
                <CommandShortcut>
                  {h.market === "in" ? "🇮🇳" : "🇺🇸"} {h.exchange}
                  {h.type === "ETF" ? " · ETF" : ""}
                </CommandShortcut>
              </CommandItem>
            ))}
            {searching && others.length === 0 && (
              <CommandItem value="searching" disabled>
                <Loader2 className="animate-spin" /> Looking up listed stocks…
              </CommandItem>
            )}
          </CommandGroup>
        )}

        {actions.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              {actions.map((a) => (
                <CommandItem key={a.key} value={`action ${a.key}`} onSelect={() => run(a.run)}>
                  {a.icon} {a.label}
                  {a.hint && <CommandShortcut>{a.hint}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {pages.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Go to">
              {pages.map((t) => (
                <CommandItem key={t.to} value={`page ${t.to}`} onSelect={() => run(() => navigate(t.to))}>
                  <ArrowRight /> {t.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {(!typed || matches("sign out log out", typed)) && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Account">
              <CommandItem value="sign out" onSelect={() => run(() => void logout())}>
                <LogOut /> Sign out
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

/** A holding in one line: what it is, what it's worth, and how it's doing. */
function StockLine({ h, ccy }: { h: HoldingRow; ccy: string }) {
  const value = num(h.baseCurrentValue) ?? num(h.baseInvested);
  const pnl = num(h.baseUnrealisedPnl);
  const inv = num(h.baseInvested);
  const pct = pnl !== null && inv ? pnl / Math.abs(inv) : null;
  return (
    <>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{h.security.symbol}</span>
        {h.security.name !== h.security.symbol && <span className="ml-2 text-muted-foreground">{h.security.name}</span>}
      </span>
      <span className="shrink-0 text-right text-xs tabular-nums">
        {value !== null && <span className="font-medium">{compactMoney(value, ccy)}</span>}
        {pct !== null && <span className={cn("ml-2", pct >= 0 ? "text-gain" : "text-loss")}>{signedPct(pct, 1)}</span>}
      </span>
    </>
  );
}
