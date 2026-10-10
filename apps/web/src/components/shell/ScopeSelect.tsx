import type { ReactNode } from "react";
import { ChevronDown, Landmark, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/kit/Segmented";
import { useAllAccounts, useFilter, usePortfolios, type MarketFilter } from "@/lib/hooks";
import { brokerLabel } from "@/lib/brokers";
import { useAuth } from "@/auth/AuthContext";

const US_BROKERS = new Set(["vested", "ibkr"]);

/**
 * The filter every data screen shares: whose money (one or several people), at which brokers (one or
 * several), in which market (India, US, or both). It's remembered per login and applies everywhere —
 * every figure on every page is worked out from just that slice of the ledger. Each control only
 * shows when there's something to choose between. `market={false}` hides the market switch, for a
 * page that has its own; `currency` adds the "US in ₹" switch, for pages that show US figures.
 */
export function ScopeSelect({ market = true, clearable = true, currency = false }: { market?: boolean; clearable?: boolean; currency?: boolean }) {
  const f = useFilter();
  const { data: people } = usePortfolios();
  const { data: accounts } = useAllAccounts();
  if (!people || !accounts) return null;

  const brokerIds = [...new Set(accounts.map((a) => a.broker))].sort((a, b) => brokerLabel(a).localeCompare(brokerLabel(b)));
  const showPeople = people.length > 1;
  const showBrokers = brokerIds.length > 1;
  const showMarket = market && accounts.some((a) => a.currency !== "INR" || US_BROKERS.has(a.broker)) || (market && f.market !== null);
  if (!showPeople && !showBrokers && !showMarket && !f.active) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter what's shown">
      {showPeople && (
        <MultiPick
          icon={<Users />}
          title="Whose money"
          everyone="Everyone"
          plural="people"
          options={people.map((p) => ({ id: p.id, label: p.name }))}
          value={f.people}
          onChange={f.setPeople}
        />
      )}
      {showBrokers && (
        <MultiPick
          icon={<Landmark />}
          title="Which brokers"
          everyone="All brokers"
          plural="brokers"
          options={brokerIds.map((b) => ({ id: b, label: brokerLabel(b) }))}
          value={f.brokers}
          onChange={f.setBrokers}
        />
      )}
      {showMarket && (
        <Segmented<"all" | "in" | "us">
          size="sm"
          ariaLabel="Market"
          value={f.market ?? "all"}
          onChange={(v) => f.setMarket(v === "all" ? null : (v as MarketFilter))}
          options={[
            { value: "all", label: "Both" },
            { value: "in", label: "🇮🇳 India" },
            { value: "us", label: "🇺🇸 US" },
          ]}
        />
      )}
      {currency && <CurrencySwitch />}
      {clearable && f.active && (
        <Button variant="ghost" size="sm" onClick={f.clear} aria-label="Clear the filter">
          <X /> Clear
        </Button>
      )}
    </div>
  );
}

const SYMBOL: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

/**
 * Show US figures in their own dollars or in rupees. In rupees, what something is worth is at today's
 * rate and what you paid or received is at the rate on that day. Only shown when there's US money
 * in view.
 */
export function CurrencySwitch() {
  const f = useFilter();
  const { user } = useAuth();
  const { data: accounts } = useAllAccounts();
  const base = user?.baseCurrency ?? "INR";
  if (!accounts || f.market === "in") return null;
  const foreign = accounts.find((a) => a.currency !== base) ?? accounts.find((a) => US_BROKERS.has(a.broker));
  if (!foreign) return null;
  const own = foreign.currency !== base ? foreign.currency : "USD";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      US in
      <Segmented<"own" | "base">
        size="xs"
        ariaLabel="Show US figures in"
        value={f.usInBase ? "base" : "own"}
        onChange={(v) => f.setUsInBase(v === "base")}
        options={[
          { value: "own", label: SYMBOL[own] ?? own },
          { value: "base", label: SYMBOL[base] ?? base },
        ]}
      />
    </span>
  );
}

function MultiPick({
  icon,
  title,
  everyone,
  plural,
  options,
  value,
  onChange,
}: {
  icon: ReactNode;
  title: string;
  everyone: string;
  plural: string;
  options: { id: string; label: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const label = value.length === 0 ? everyone : value.length === 1 ? (options.find((o) => o.id === value[0])?.label ?? `1 ${plural}`) : `${value.length} ${plural}`;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={value.length ? "secondary" : "outline"} size="sm" aria-label={`${title}: ${label}`}>
          {icon} {label} <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60 rounded-2xl">
        <DropdownMenuLabel className="text-muted-foreground">{title} · pick any</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={value.length === 0} onCheckedChange={() => onChange([])} onSelect={(e) => e.preventDefault()}>
          {everyone}
        </DropdownMenuCheckboxItem>
        {options.map((o) => (
          <DropdownMenuCheckboxItem key={o.id} checked={value.includes(o.id)} onCheckedChange={() => toggle(o.id)} onSelect={(e) => e.preventDefault()}>
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shown instead of a page's "nothing yet" state when it's the filter that's empty, not the data. */
export function NoMatch({ what = "holdings" }: { what?: string }) {
  const f = useFilter();
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border bg-card px-6 py-12 text-center">
      <p className="font-display text-3xl">Nothing in this view</p>
      <p className="max-w-md text-sm text-muted-foreground">No {what} match the people, brokers or market you've picked. Widen the filter, or clear it to see everything.</p>
      <ScopeSelect clearable={false} />
      <Button onClick={f.clear}>
        <X /> Clear the filter
      </Button>
    </div>
  );
}
