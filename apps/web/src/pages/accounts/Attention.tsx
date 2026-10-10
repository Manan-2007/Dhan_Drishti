import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  BadgeAlert,
  CalendarClock,
  CalendarRange,
  ChevronDown,
  CircleCheck,
  ClipboardList,
  Clock,
  Coins,
  FilePlus,
  FileWarning,
  Globe,
  Hourglass,
  RefreshCw,
  Scale,
  Split,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GUIDES } from "@/components/ExportHelp";
import { ScopeSelect } from "@/components/shell/ScopeSelect";
import { stockHref } from "@/components/StockLinks";
import { useAttention, useFilter } from "@/lib/hooks";
import { useRefreshPrices } from "@/lib/prices";
import { brokerLabel } from "@/lib/brokers";
import { api, type AttentionItem, type AttentionSeverity } from "@/lib/api";
import { cn } from "@/lib/utils";

const ICON: Record<string, typeof Clock> = {
  missing_buys: FileWarning,
  file_gap: CalendarRange,
  stale_files: CalendarClock,
  no_files: FilePlus,
  no_dividends: Coins,
  opening_balance: ClipboardList,
  statement_short: Scale,
  expiry_estimated: CalendarClock,
  expired_open: Hourglass,
  unpriced: BadgeAlert,
  stale_prices: Clock,
  fx_missing: Globe,
  fx_at_cost: ArrowLeftRight,
  split_unconfirmed: Split,
  split_added: Split,
};

const SEV: Record<AttentionSeverity, { label: string; ring: string; icon: string; pill: string }> = {
  high: { label: "Fix first", ring: "border-loss/50", icon: "text-loss", pill: "bg-loss/15 text-loss" },
  warn: { label: "Worth fixing", ring: "border-warning/40", icon: "text-warning", pill: "bg-warning/15 text-warning" },
  info: { label: "Good to check", ring: "border-border", icon: "text-muted-foreground", pill: "bg-raised text-muted-foreground" },
  done: { label: "Done for you", ring: "border-gain/30", icon: "text-gain", pill: "bg-gain/15 text-gain" },
};

const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "From 14 Apr 2026 to today", "Up to 1 Apr 2024", … — the dates the file must cover. */
function period(from: string | null, to: string | null): string {
  const today = new Date().toISOString().slice(0, 10);
  const end = !to ? "today" : to >= today ? "today" : longDate(to);
  if (!from) return `From when you bought them up to ${end}`;
  return `From ${longDate(from)} to ${end}`;
}

/**
 * Needs attention: everything missing or uncertain in your data, each pinned to the account, the
 * stocks and the exact file (with its dates) that fixes it. Linked from Home.
 */
export function Attention() {
  const { scope } = useFilter();
  const { data, isLoading } = useAttention(scope);
  const { hash } = useLocation();

  // Opened from Home on one item: bring it into view.
  useEffect(() => {
    if (!hash || !data) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [hash, data]);

  const items = data?.items ?? [];
  const open = items.filter((i) => i.severity !== "done");
  const counts = { fix: items.filter((i) => i.severity === "high" || i.severity === "warn").length, check: items.filter((i) => i.severity === "info").length, done: items.filter((i) => i.severity === "done").length };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          What's missing or uncertain in your data — which account, which stocks, and the exact file (with its dates) that fixes it. Worked out from your own records; nothing is guessed.
        </p>
        <ScopeSelect market={false} />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className={cn("rounded-full px-3 py-1 font-medium", counts.fix ? SEV.warn.pill : "bg-raised text-muted-foreground")}>{counts.fix} worth fixing</span>
            <span className="rounded-full bg-raised px-3 py-1 font-medium text-muted-foreground">{counts.check} good to check</span>
            {counts.done > 0 && <span className={cn("rounded-full px-3 py-1 font-medium", SEV.done.pill)}>{counts.done} done for you</span>}
          </div>
          {open.length === 0 && (
            <div className="flex items-center gap-3 rounded-2xl border bg-card p-6">
              <CircleCheck className="size-6 text-gain" />
              <div>
                <p className="font-semibold">All clear</p>
                <p className="text-sm text-muted-foreground">Your files cover everything we can check: prices, exchange rates, purchases behind every sale, and splits.</p>
              </div>
            </div>
          )}
          <ul className="space-y-3">
            {items.map((i) => (
              <li key={i.id}>
                <ItemCard item={i} focused={hash === `#${encodeURIComponent(i.id)}` || hash === `#${i.id}`} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ItemCard({ item, focused }: { item: AttentionItem; focused: boolean }) {
  const sev = SEV[item.severity];
  const Icon = ICON[item.kind] ?? FileWarning;
  const [showAll, setShowAll] = useState(false);
  const stocks = showAll ? item.stocks : item.stocks.slice(0, 8);
  return (
    <article id={item.id} className={cn("scroll-mt-24 rounded-2xl border bg-card p-5 transition-shadow", sev.ring, focused && "shadow-[0_0_0_2px_var(--color-primary)]")}>
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 size-5 shrink-0", sev.icon)} />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{item.title}</h2>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", sev.pill)}>{sev.label}</span>
            {item.account && (
              <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                {brokerLabel(item.account.broker)}
                {item.account.person ? ` · ${item.account.person}` : ""}
              </span>
            )}
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{item.detail}</p>

          {item.stocks.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {stocks.map((s) => (
                <Link
                  key={`${s.id}|${s.note ?? ""}`}
                  to={stockHref.holding(s.id)}
                  className="rounded-xl border bg-raised/40 px-3 py-1.5 text-xs transition-colors hover:border-primary/50"
                  title={s.name}
                >
                  <span className="font-semibold">{s.symbol}</span>
                  {s.note && <span className="text-muted-foreground"> · {s.note}</span>}
                </Link>
              ))}
              {item.stocks.length > 8 && (
                <button type="button" onClick={() => setShowAll((v) => !v)} className="rounded-xl px-3 py-1.5 text-xs text-primary hover:underline">
                  {showAll ? "Show fewer" : `+ ${item.stocks.length - 8} more`}
                </button>
              )}
            </div>
          )}

          {item.need && <NeedBox need={item.need} />}
          <FixButton item={item} />
        </div>
      </div>
    </article>
  );
}

/** The file that fixes it: what, for which dates, and how to download it. */
function NeedBox({ need }: { need: NonNullable<AttentionItem["need"]> }) {
  const [open, setOpen] = useState(false);
  const guide = need.guide ? GUIDES[need.guide] : undefined;
  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
      <p className="text-xs font-semibold tracking-wide text-primary uppercase">What fixes it</p>
      <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">File</dt>
        <dd className="font-medium">{need.file}</dd>
        <dt className="text-muted-foreground">Dates</dt>
        <dd className="font-medium">{period(need.from, need.to)}</dd>
        {need.segment && (
          <>
            <dt className="text-muted-foreground">Segment</dt>
            <dd className="font-medium">{need.segment}</dd>
          </>
        )}
      </dl>
      {guide && (
        <div className="mt-3">
          <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" aria-expanded={open}>
            How to download it <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <div className="mt-2 text-sm text-muted-foreground">
              <p className="text-xs">{guide.where}</p>
              <ol className="mt-2 ml-4 list-decimal space-y-1">
                {guide.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {guide.note && <p className="mt-2 text-xs">{guide.note}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FixButton({ item }: { item: AttentionItem }) {
  const navigate = useNavigate();
  const refresh = useRefreshPrices();
  const qc = useQueryClient();
  const splits = useMutation({
    mutationFn: () => api.post<{ added: unknown[]; unconfirmed: number }>("/api/splits/check", {}),
    onSuccess: () => void qc.invalidateQueries(),
  });
  if (item.fix === "add_files")
    return (
      <Button size="sm" onClick={() => navigate("/accounts")}>
        <Upload /> Add the file
      </Button>
    );
  if (item.fix === "refresh_prices")
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={refresh.isPending}
        onClick={() =>
          toast.promise(refresh.mutateAsync(), {
            loading: "Refreshing prices and exchange rates…",
            success: (r) => `Priced ${r.updated} of ${r.requested}${r.failed ? ` · ${r.failed} without a price` : ""}`,
            error: "Couldn't refresh",
          })
        }
      >
        <RefreshCw className={cn(refresh.isPending && "animate-spin")} /> Refresh prices
      </Button>
    );
  if (item.fix === "check_splits")
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={splits.isPending}
        onClick={() =>
          toast.promise(splits.mutateAsync(), {
            loading: "Checking public split data…",
            success: (r) => (r.added.length ? `Filled in ${r.added.length} split${r.added.length === 1 ? "" : "s"}` : "Nothing new to fill in"),
            error: "Couldn't reach the split data",
          })
        }
      >
        <RefreshCw className={cn(splits.isPending && "animate-spin")} /> Check again
      </Button>
    );
  return null;
}

/** How many things are worth fixing — shown on the tab. */
export function AttentionCount() {
  const { scope } = useFilter();
  const { data } = useAttention(scope);
  const n = (data?.items ?? []).filter((i) => i.severity === "high" || i.severity === "warn").length;
  if (!n) return null;
  return <span className="rounded-full bg-warning/20 px-1.5 text-[11px] leading-5 font-semibold text-warning tabular-nums">{n}</span>;
}
