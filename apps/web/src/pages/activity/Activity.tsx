import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, ChevronDown, Layers, Loader2, Plus, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented } from "@/components/kit/Segmented";
import { Stat } from "@/components/kit/Stat";
import { Empty } from "@/components/kit/Empty";
import { ScopeSelect } from "@/components/shell/ScopeSelect";
import { AddTransactionModal } from "@/components/AddTransactionModal";
import { useActivity, useAllAccounts, useFilter, usePortfolios } from "@/lib/hooks";
import { assetClassLabel, compactMoney, dateShort, financialYear, money, qty } from "@/lib/format";
import type { Transaction } from "@/lib/api";
import { cn } from "@/lib/utils";
import { readableContract } from "@/lib/instrument";

type Group = "all" | "trades" | "income" | "cash" | "other";
const GROUPS: { value: Group; label: string; types?: string[] }[] = [
  { value: "all", label: "All" },
  { value: "trades", label: "Trades", types: ["buy", "sell"] },
  { value: "income", label: "Income", types: ["dividend", "interest"] },
  { value: "cash", label: "Money in & out", types: ["deposit", "withdrawal", "fee", "tax"] },
  { value: "other", label: "Other", types: ["split", "bonus", "transfer_in", "transfer_out"] },
];

type Period = "fy" | "lastfy" | "12m" | "all";

/** Financial-year boundaries read in UTC, the same calendar the ledger stores dates in. */
function periodRange(p: Period): { from?: string; to?: string } {
  const now = new Date();
  const fyStart = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  if (p === "fy") return { from: `${fyStart}-04-01` };
  if (p === "lastfy") return { from: `${fyStart - 1}-04-01`, to: `${fyStart}-03-31T23:59:59.999Z` };
  if (p === "12m") return { from: new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10) };
  return {};
}

const SOURCES: Record<string, string> = {
  zerodha: "Zerodha tradebook",
  "zerodha-holdings": "Zerodha holdings statement",
  dhan: "Dhan tradebook",
  "dhan-txn": "Dhan transaction report",
  "dhan-pnl": "Dhan P&L report",
  vested: "Vested statement",
  ibkr: "Interactive Brokers",
  binance: "Binance",
  cas: "Mutual fund CAS",
  dividends: "Dividend statement",
  funds: "Funds statement",
  holdings: "Holdings statement",
  snapshot: "Holdings statement",
  expiry: "Exchange settlement at expiry (estimated)",
  generic: "Imported file",
  manual: "Added by hand",
};
const sourceLabel = (s: string | null) => (s ? (SOURCES[s] ?? (s.endsWith("-pnl") ? "Broker P&L report" : s)) : "Added by hand");

type Tone = "buy" | "sell" | "income" | "neutral";
interface Described {
  verb: string;
  tone: Tone;
  /** Money into (+) or out of (−) the account, in the entry's own currency; null when none moves. */
  cash: number | null;
  tag?: string;
}

function describe(t: Transaction): Described {
  const gross = Math.abs(Number(t.grossAmount));
  const charges = Number(t.fees) + Number(t.taxes);
  const fromStatement = t.sourceBroker === "snapshot";
  switch (t.type) {
    case "buy":
      return fromStatement
        ? { verb: "Opening balance", tone: "neutral", cash: null, tag: "from holdings statement" }
        : { verb: "Bought", tone: "buy", cash: -(gross + charges), tag: t.sourceBroker === "expiry" ? "settled at expiry, estimated" : undefined };
    case "sell":
      return { verb: "Sold", tone: "sell", cash: gross - charges, tag: t.sourceBroker === "expiry" ? "settled at expiry, estimated" : t.sourceBroker?.endsWith("-pnl") ? "filled from P&L report" : undefined };
    case "dividend":
      return { verb: "Dividend", tone: "income", cash: gross };
    case "interest":
      return { verb: "Interest", tone: "income", cash: gross };
    case "deposit":
      return { verb: "Money added", tone: "neutral", cash: gross };
    case "withdrawal":
      return { verb: "Money withdrawn", tone: "neutral", cash: -gross };
    case "fee":
      return { verb: "Charges", tone: "neutral", cash: -gross };
    case "tax":
      return { verb: "Tax", tone: "neutral", cash: -gross };
    case "split":
      return { verb: "Split", tone: "neutral", cash: null };
    case "bonus":
      return { verb: "Bonus shares", tone: "neutral", cash: null };
    case "transfer_in":
      return { verb: "Moved in", tone: "neutral", cash: null };
    case "transfer_out":
      return fromStatement ? { verb: "Balance adjustment", tone: "neutral", cash: null, tag: "from holdings statement" } : { verb: "Moved out", tone: "neutral", cash: null };
    default:
      return { verb: t.type, tone: "neutral", cash: null };
  }
}

const PILL: Record<Tone, string> = {
  buy: "bg-gain/15 text-gain",
  sell: "bg-loss/15 text-loss",
  income: "bg-primary/15 text-primary",
  neutral: "bg-raised text-muted-foreground",
};

function signed(n: number, currency: string): string {
  if (n === 0) return money(0, currency);
  return `${n > 0 ? "+" : "−"}${money(Math.abs(n), currency)}`;
}

/** Time of day, only when the broker gave one (a bare date is stored at UTC midnight). */
function timeOf(iso: string): string | null {
  if (iso.slice(11, 19) === "00:00:00") return null;
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

/** A day's trades in one contract or share, folded together when there are several. */
interface Entry {
  key: string;
  rows: Transaction[];
}

function foldDay(rows: Transaction[]): Entry[] {
  const out: Entry[] = [];
  const index = new Map<string, Entry>();
  for (const t of rows) {
    const foldable = (t.type === "buy" || t.type === "sell") && t.security && t.sourceBroker !== "snapshot";
    const k = foldable ? `${t.security!.id}|${t.accountId ?? ""}` : null;
    const hit = k ? index.get(k) : undefined;
    if (hit) hit.rows.push(t);
    else {
      const e = { key: k ? `${t.tradeDate.slice(0, 10)}|${k}` : t.id, rows: [t] };
      out.push(e);
      if (k) index.set(k, e);
    }
  }
  return out;
}

export function Activity() {
  const { portfolioId } = useFilter();
  const { data: portfolios } = usePortfolios();
  const { data: accounts } = useAllAccounts();
  const navigate = useNavigate();
  const [group, setGroup] = useState<Group>("all");
  const [period, setPeriod] = useState<Period>("all");
  const [accountId, setAccountId] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  const range = useMemo(() => periodRange(period), [period]);
  const types = GROUPS.find((g) => g.value === group)?.types;
  const query = useActivity({ portfolioId, accountId: accountId || undefined, types, q: q || undefined, ...range });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.transactions) ?? [], [query.data]);
  const summary = query.data?.pages[0]?.summary;

  const days = useMemo(() => {
    const byDay = new Map<string, Transaction[]>();
    for (const t of rows) {
      const d = t.tradeDate.slice(0, 10);
      byDay.set(d, [...(byDay.get(d) ?? []), t]);
    }
    return [...byDay.entries()].map(([day, list]) => ({ day, entries: foldDay(list) }));
  }, [rows]);

  // Keep loading older entries as the end of the list comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((seen) => {
      if (seen[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [query]);

  const fy = financialYear(new Date().toISOString());
  const periods: { value: Period; label: string }[] = [
    { value: "all", label: "All time" },
    { value: "fy", label: `This year (${fy.replace("FY ", "")})` },
    { value: "lastfy", label: "Last year" },
    { value: "12m", label: "12 months" },
  ];
  const filtered = group !== "all" || period !== "all" || !!accountId || !!q;
  const ccy = summary?.baseCurrency ?? "INR";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented ariaLabel="What to show" options={GROUPS.map(({ value, label }) => ({ value, label }))} value={group} onChange={setGroup} className="no-scrollbar max-w-full overflow-x-auto" />
        <Segmented ariaLabel="Period" size="xs" options={periods} value={period} onChange={setPeriod} className="no-scrollbar max-w-full overflow-x-auto" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a share, fund or contract" className="h-10 rounded-full pl-10" aria-label="Search activity" />
        </div>
        {accounts && accounts.length > 1 && (
          <select
            aria-label="Account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="h-10 cursor-pointer rounded-full border border-input bg-card px-4 text-sm"
          >
            <option value="">All accounts</option>
            {accounts
              .filter((a) => !portfolioId || a.portfolioId === portfolioId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        )}
        <ScopeSelect />
        <Button className="ml-auto" variant="outline" onClick={() => setAdding(true)} disabled={!portfolios?.length}>
          <Plus /> Add an entry
        </Button>
      </div>

      {summary && summary.count > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Bought" value={compactMoney(summary.bought, ccy)} title={money(summary.bought, ccy)} />
          <Stat label="Sold" value={compactMoney(summary.sold, ccy)} title={money(summary.sold, ccy)} />
          <Stat label="Dividends & interest" value={compactMoney(summary.income, ccy)} tone={Number(summary.income) > 0 ? "gain" : undefined} title={money(summary.income, ccy)} />
          <Stat
            label="Charges paid"
            value={compactMoney(summary.charges, ccy)}
            sub={`${summary.count.toLocaleString("en-IN")} entries${summary.unconverted ? ` · ${summary.unconverted} awaiting an exchange rate` : ""}`}
            title={money(summary.charges, ccy)}
          />
        </div>
      )}

      {query.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : rows.length === 0 ? (
        filtered ? (
          <Empty title="Nothing here" body="No entries match these filters. Try a wider period or a different search." />
        ) : (
          <Empty
            title="No activity yet"
            body="Every trade, dividend and deposit from your broker files shows up here, newest first."
            action={
              <Button onClick={() => navigate("/accounts")}>
                <Upload /> Add files
              </Button>
            }
          />
        )
      ) : (
        <div className="space-y-6">
          {days.map(({ day, entries }, i) => {
            const month = day.slice(0, 7);
            const newMonth = i === 0 || days[i - 1]!.day.slice(0, 7) !== month;
            return (
              <section key={day} className="space-y-2">
                {newMonth && (
                  <h2 className="font-display pt-2 text-3xl">
                    {new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}
                  </h2>
                )}
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
                </p>
                <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                  {entries.map((e) => (
                    <EntryRow key={e.key} entry={e} />
                  ))}
                </ul>
              </section>
            );
          })}
          <div ref={sentinel} className="flex justify-center py-4">
            {query.hasNextPage ? (
              <Button variant="ghost" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                {query.isFetchingNextPage ? <Loader2 className="animate-spin" /> : <ChevronDown />} Older entries
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">That's everything{filtered ? " for this filter" : ""}.</p>
            )}
          </div>
        </div>
      )}

      {adding && portfolios && <AddTransactionModal portfolios={portfolios} defaultPortfolioId={portfolioId} onClose={() => setAdding(false)} />}
    </div>
  );
}

function EntryRow({ entry }: { entry: Entry }) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const first = entry.rows[0]!;
  const many = entry.rows.length > 1;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised/60"
      >
        {many ? <FoldedSummary rows={entry.rows} /> : <SingleSummary t={first} />}
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t bg-raised/30 px-4 py-4">{many ? <FoldedDetail rows={entry.rows} /> : <Detail t={first} />}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function Verb({ d }: { d: Described }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", PILL[d.tone])}>{d.verb}</span>;
}

function Amount({ value, currency, tone }: { value: number | null; currency: string; tone: Tone }) {
  if (value === null) return <span className="text-sm text-muted-foreground">—</span>;
  return <span className={cn("text-sm font-semibold whitespace-nowrap tabular-nums", value > 0 && (tone === "sell" || tone === "income") && "text-gain")}>{signed(value, currency)}</span>;
}

function SingleSummary({ t }: { t: Transaction }) {
  const d = describe(t);
  const contract = t.security ? readableContract(t.security.symbol) : null;
  const what = contract?.title ?? t.security?.symbol ?? (t.type === "deposit" || t.type === "withdrawal" ? "Cash" : "—");
  const detail =
    t.type === "split"
      ? `×${Number(t.price)} units`
      : Number(t.quantity) && Number(t.price)
        ? `${qty(t.quantity)} @ ${money(t.price, t.currency)}`
        : Number(t.quantity)
          ? `${qty(t.quantity)} units`
          : null;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <Verb d={d} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold">{what}</span>
          {detail && <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">{detail}</span>}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {[contract?.expiry ?? (t.security && t.security.name !== t.security.symbol ? t.security.name : null), t.account?.name, d.tag, timeOf(t.tradeDate)].filter(Boolean).join(" · ")}
        </span>
      </span>
      <Amount value={d.cash} currency={t.currency} tone={d.tone} />
    </span>
  );
}

function FoldedSummary({ rows }: { rows: Transaction[] }) {
  const t = rows[0]!;
  let bought = 0;
  let sold = 0;
  let cash = 0;
  for (const r of rows) {
    const d = describe(r);
    if (r.type === "buy") bought += Number(r.quantity);
    else sold += Number(r.quantity);
    cash += d.cash ?? 0;
  }
  const contract = t.security ? readableContract(t.security.symbol) : null;
  const verb: Described = bought && sold ? { verb: "Traded", tone: "neutral", cash } : bought ? { verb: "Bought", tone: "buy", cash } : { verb: "Sold", tone: "sell", cash };
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <Verb d={verb} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold">{contract?.title ?? t.security?.symbol}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
            <Layers className="size-3.5" /> {rows.length} trades
          </span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {[bought ? `bought ${qty(bought)}` : null, sold ? `sold ${qty(sold)}` : null, contract?.expiry, t.account?.name].filter(Boolean).join(" · ")}
        </span>
      </span>
      <Amount value={cash} currency={t.currency} tone={cash > 0 ? "sell" : "buy"} />
    </span>
  );
}

function FoldedDetail({ rows }: { rows: Transaction[] }) {
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {rows.map((r) => {
          const d = describe(r);
          return (
            <li key={r.id} className="flex items-center gap-3 text-sm">
              <Verb d={d} />
              <span className="flex-1 text-muted-foreground">
                {qty(r.quantity)} @ {money(r.price, r.currency)}
                {timeOf(r.tradeDate) && <> · {timeOf(r.tradeDate)}</>}
              </span>
              <Amount value={d.cash} currency={r.currency} tone={d.tone} />
            </li>
          );
        })}
      </ul>
      {rows[0]!.security && <SecurityLink id={rows[0]!.security.id} symbol={readableContract(rows[0]!.security.symbol)?.title ?? rows[0]!.security.symbol} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm tabular-nums">{children}</dd>
    </div>
  );
}

function Detail({ t }: { t: Transaction }) {
  const d = describe(t);
  const charges = Number(t.fees) + Number(t.taxes);
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="Date">
          {dateShort(t.tradeDate)}
          {timeOf(t.tradeDate) && <span className="text-muted-foreground"> · {timeOf(t.tradeDate)}</span>}
        </Field>
        {t.security && <Field label="Kind">{assetClassLabel(t.security.assetClass) + (t.security.sector ? ` · ${t.security.sector}` : "")}</Field>}
        {Number(t.quantity) > 0 && t.type !== "split" && <Field label="Units">{qty(t.quantity)}</Field>}
        {Number(t.price) > 0 && t.type !== "split" && <Field label="Price">{money(t.price, t.currency)}</Field>}
        <Field label="Amount">{money(t.grossAmount, t.currency)}</Field>
        {charges > 0 && (
          <Field label="Charges">
            {money(charges, t.currency)}
            <span className="text-muted-foreground"> (fees {money(t.fees, t.currency)} · taxes {money(t.taxes, t.currency)})</span>
          </Field>
        )}
        {d.cash !== null && <Field label={d.cash >= 0 ? "Money in" : "Money out"}>{money(Math.abs(d.cash), t.currency)}</Field>}
        {t.account && <Field label="Account">{t.account.name}</Field>}
        {t.security?.isin && <Field label="ISIN">{t.security.isin}</Field>}
        {t.fxRateToBase && t.currency !== "INR" && <Field label="Exchange rate that day">{Number(t.fxRateToBase).toFixed(4)}</Field>}
        <Field label="From">{sourceLabel(t.sourceBroker)}</Field>
      </dl>
      {t.notes && <p className="max-w-3xl text-sm text-muted-foreground">{t.notes}</p>}
      {t.security && <SecurityLink id={t.security.id} symbol={readableContract(t.security.symbol)?.title ?? t.security.symbol} />}
    </div>
  );
}

function SecurityLink({ id, symbol }: { id: string; symbol: string }) {
  return (
    <Link to={`/portfolio/security/${id}`} className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline">
      Everything about {symbol} <ArrowRight className="size-3.5" />
    </Link>
  );
}
