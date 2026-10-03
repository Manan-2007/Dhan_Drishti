import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, ExternalLink, KeyRound, Loader2, ShieldAlert, Sparkles, Telescope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/kit/Segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useFilter, useNews } from "@/lib/hooks";
import type { FeedItem, Headline, NewsCompany, NewsStance, NewsTone } from "@/lib/api";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";

const STANCE: Record<NewsStance, { label: string; className: string; rank: number }> = {
  headwind: { label: "▼ Headwind", className: "border-loss/40 text-loss", rank: 0 },
  mixed: { label: "◆ Mixed", className: "border-warning/40 text-warning", rank: 1 },
  tailwind: { label: "▲ Tailwind", className: "border-gain/40 text-gain", rank: 2 },
  quiet: { label: "● Quiet", className: "border-border text-muted-foreground", rank: 3 },
};
const MOOD = {
  positive: { label: "Upbeat", className: "border-gain/40 text-gain" },
  negative: { label: "Nervous", className: "border-loss/40 text-loss" },
  mixed: { label: "Mixed", className: "border-warning/40 text-warning" },
} as const;
const TONE_DOT: Record<NewsTone, string> = { positive: "bg-gain", negative: "bg-loss", neutral: "bg-muted-foreground/60" };

const share = (w: number) => (w >= 0.995 ? "all" : w < 0.01 ? "under 1%" : `${Math.round(w * 100)}%`);

function Tag({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", className)}>{children}</span>;
}

/** Re-render every second so "updated 12 s ago" counts up. */
function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** "Updated 12 s ago" — ticks on its own so the rest of the page doesn't re-render every second. */
function UpdatedLabel({ at, busy }: { at: number; busy: boolean }) {
  const now = useNow();
  if (busy) return <>Checking for news…</>;
  const secs = at ? Math.max(0, Math.round((now - at) / 1000)) : null;
  if (secs === null) return <>Live</>;
  return <>Checked for news {secs < 5 ? "just now" : secs < 90 ? `${secs} s ago` : `${Math.round(secs / 60)} min ago`}</>;
}

function HeadlineLink({ h, tone, dense }: { h: Headline; tone?: NewsTone | null; dense?: boolean }) {
  return (
    <a href={h.link} target="_blank" rel="noreferrer noopener" className="group/h flex gap-2.5 rounded-lg py-1.5 transition-colors">
      <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", tone ? TONE_DOT[tone] : "bg-border")} aria-hidden />
      <span className="min-w-0">
        <span className={cn("block leading-snug group-hover/h:text-primary", dense ? "line-clamp-2 text-sm" : "text-[15px]")} title={h.title}>
          {h.title}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {[h.source, `published ${ago(h.publishedAt)}`].filter(Boolean).join(" · ")}
        </span>
      </span>
    </a>
  );
}

/** True on devices with a real pointer; touch screens open tiles with a tap instead. */
function useCanHover() {
  const [can, setCan] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(hover: hover)");
    if (!mq) return;
    const on = () => setCan(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return can;
}

/** Collapsed tile height; every tile in the grid is the same size until it opens. */
const TILE_H = 196;

/**
 * One holding as a tile: name, stance and the gist. Hover (or tap, or tab to it) and it grows in
 * place — floating over its neighbours so the grid never jumps — to show the risks, the outlook
 * and the headlines.
 */
function CompanyTile({ c, ai }: { c: NewsCompany; ai: boolean }) {
  const canHover = useCanHover();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  // Stays above the neighbours until the closing animation has finished.
  const [raised, setRaised] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = (v: boolean) => {
    window.clearTimeout(timer.current);
    if (v) setRaised(true);
    // A short pause so sweeping the mouse across the grid doesn't pop every tile open.
    timer.current = window.setTimeout(() => setOpen(v), v ? 140 : 60);
  };

  const read = c.read;
  const gist = read?.summary ?? c.items[0]?.title ?? null;
  const meta = [read && read.risks.length ? `${read.risks.length} risk${read.risks.length === 1 ? "" : "s"}` : null, c.items.length ? `${c.items.length} headlines` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn("relative", raised && "z-20")}
      style={{ height: TILE_H }}
      onMouseEnter={canHover ? () => show(true) : undefined}
      onMouseLeave={canHover ? () => show(false) : undefined}
      onFocus={() => show(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) show(false);
      }}
    >
      <motion.article
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${c.name}: ${open ? "showing details" : "show details"}`}
        onClick={
          canHover
            ? undefined
            : () => {
                window.clearTimeout(timer.current);
                if (!open) setRaised(true);
                setOpen(!open);
              }
        }
        initial={false}
        animate={{ height: open ? "auto" : TILE_H }}
        transition={reduce ? { duration: 0 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        onAnimationComplete={() => {
          if (!open) setRaised(false);
        }}
        className={cn(
          "absolute inset-x-0 top-0 flex cursor-default flex-col overflow-hidden rounded-2xl border bg-card p-5 outline-none transition-[border-color,box-shadow] duration-300",
          open ? "border-primary/40 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.85)]" : "hover:border-primary/30",
          !canHover && "cursor-pointer",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">{c.name}</h3>
            <p className="text-xs text-muted-foreground">
              {c.symbol} · {share(c.weight)} of your shares
            </p>
          </div>
          {read && <Tag className={STANCE[read.stance].className}>{STANCE[read.stance].label}</Tag>}
        </div>

        {!c.loaded ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : gist ? (
          <p className={cn("mt-3 text-sm leading-relaxed", !open && "line-clamp-3", !read && "text-muted-foreground")}>{gist}</p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No news this week.</p>
        )}

        {!open && (
          <p className="mt-auto flex items-center justify-between gap-2 pt-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              {ai && !read && c.items.length > 0 && <Loader2 className="size-3 animate-spin text-primary" />}
              {ai && !read && c.items.length > 0 ? "Reading the headlines…" : meta}
            </span>
            {c.items.length > 0 && <ChevronDown className="size-3.5" />}
          </p>
        )}

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="more"
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, delay: reduce ? 0 : 0.08 }}
              className="mt-3 space-y-3"
            >
              {read && read.risks.length > 0 && (
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-loss uppercase">
                    <ShieldAlert className="size-3.5" /> Watch out for
                  </p>
                  <ul className="mt-1.5 space-y-1 text-sm">
                    {read.risks.map((r) => (
                      <li key={r} className="flex gap-2">
                        <span className="mt-[8px] size-1 shrink-0 rounded-full bg-loss" aria-hidden />
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {read?.outlook && (
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-primary uppercase">
                    <Telescope className="size-3.5" /> Next few weeks
                  </p>
                  <p className="mt-1.5 text-sm text-muted-foreground">{read.outlook}</p>
                </div>
              )}
              {c.items.length > 0 && (
                <div className="border-t pt-2">
                  {c.items.slice(0, 3).map((h) => (
                    <HeadlineLink key={h.id} h={h} tone={read?.tones[h.id]} dense />
                  ))}
                </div>
              )}
              {read && c.readAt && (
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Sparkles className="size-3" /> AI read · {read.confidence} confidence · {ago(c.readAt)}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.article>
    </div>
  );
}

type FeedFilter = "all" | "mine" | "market";
const FEED_PAGE = 12;

/** Headlines as tiles, newest first; ones that arrive while the page is open slide in marked new. */
function LiveFeed({ feed }: { feed: FeedItem[] }) {
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [limit, setLimit] = useState(FEED_PAGE);
  const reduce = useReducedMotion();
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!feed.length) return;
    if (!seen.current) {
      seen.current = new Set(feed.map((f) => f.id));
      return;
    }
    const arrived = feed.filter((f) => !seen.current!.has(f.id)).map((f) => f.id);
    if (!arrived.length) return;
    for (const id of arrived) seen.current.add(id);
    setFresh((prev) => new Set([...prev, ...arrived]));
    const t = setTimeout(() => setFresh((prev) => new Set([...prev].filter((id) => !arrived.includes(id)))), 60_000);
    return () => clearTimeout(t);
  }, [feed]);

  const matching = feed.filter((f) => (filter === "all" ? true : filter === "mine" ? f.companies.length > 0 : f.market));
  const items = matching.slice(0, limit);
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Live feed <span className="font-normal normal-case">· newest first</span>
        </h2>
        <Segmented
          size="xs"
          ariaLabel="Which news"
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setLimit(FEED_PAGE);
          }}
          options={[
            { value: "all", label: "All" },
            { value: "mine", label: "My stocks" },
            { value: "market", label: "Market" },
          ]}
        />
      </div>
      {items.length === 0 ? (
        <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">Nothing yet — headlines show up here as they come in.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <AnimatePresence initial={false}>
            {items.map((f) => (
              <motion.li
                key={f.id}
                layout={!reduce}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <a
                  href={f.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={cn(
                    "group flex h-full flex-col rounded-2xl border bg-card p-4 transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-primary/40",
                    fresh.has(f.id) && "border-primary/40",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("size-1.5 shrink-0 rounded-full", f.tone ? TONE_DOT[f.tone] : "bg-border")} aria-hidden />
                    <span className="truncate text-xs text-muted-foreground">{f.source ?? "News"}</span>
                    {fresh.has(f.id) && <Tag className="ml-auto border-primary/40 text-primary">New</Tag>}
                  </div>
                  <p className="mt-2 line-clamp-3 text-[15px] leading-snug group-hover:line-clamp-none group-hover:text-primary">{f.title}</p>
                  <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                    <span className="mr-auto text-xs text-muted-foreground">published {ago(f.publishedAt)}</span>
                    {f.companies.map((c) => (
                      <Tag key={c.securityId} className="border-border text-muted-foreground">
                        {c.symbol}
                      </Tag>
                    ))}
                    {f.market && <Tag className="border-border text-muted-foreground">Market</Tag>}
                  </div>
                </a>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {matching.length > limit && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setLimit((n) => n + FEED_PAGE)}>
            Show more <span className="text-muted-foreground">({matching.length - limit} left)</span>
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * What's being said about what you own, refreshed on its own. Headlines are public; the AI reads
 * only a company's name and its headlines. Which companies you hold and how much stay here.
 */
export function News() {
  const { portfolioId } = useFilter();
  const { data, isLoading, isError, dataUpdatedAt, isFetching } = useNews(portfolioId);
  const ai = !!data?.ai.enabled;

  const companies = [...(data?.companies ?? [])].sort((a, b) => {
    const ra = a.read ? STANCE[a.read.stance].rank : 4;
    const rb = b.read ? STANCE[b.read.stance].rank : 4;
    return ai && ra !== rb ? ra - rb : b.weight - a.weight;
  });
  const worry = ai ? companies.filter((c) => c.read?.stance === "headwind").sort((a, b) => b.weight - a.weight)[0] : undefined;
  const market = data?.market;
  const canHoverHint = useCanHover() ? "hover a tile for details" : "tap a tile for details";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl leading-none tracking-tight sm:text-5xl">News</h1>
          <p className="mt-2 text-sm text-muted-foreground">What's being said about what you own. Refreshes on its own.</p>
        </div>
        {data?.live && (
          <p className="flex items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-xs text-muted-foreground">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-gain opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-gain" />
            </span>
            <UpdatedLabel at={dataUpdatedAt} busy={data.refreshing || isFetching} />
          </p>
        )}
      </div>

      {isError && !data && <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">Couldn't reach the server for news. It'll try again on its own.</p>}

      {data && !data.live && (
        <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">News is off on this server.</p>
      )}

      {data?.live && !ai && (
        <div className="flex gap-3 rounded-2xl border border-primary/30 bg-card p-5">
          <KeyRound className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="text-sm">
            <p className="font-semibold">AI reading is off</p>
            <p className="mt-1 text-muted-foreground">
              Headlines are live. To have each stock's news read for risks and what to watch next, add an Azure OpenAI key to{" "}
              <code className="rounded bg-raised px-1.5 py-0.5 text-xs">apps/server/.env</code> (see <code className="rounded bg-raised px-1.5 py-0.5 text-xs">.env.example</code>) and restart the server.
            </p>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <Skeleton className="h-64 rounded-2xl lg:col-span-12" />
        </div>
      )}

      {data?.live && (
        <>
          {/* The market as a whole */}
          <section className="rounded-2xl border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Market today</h2>
              {market?.read && <Tag className={MOOD[market.read.mood].className}>{MOOD[market.read.mood].label}</Tag>}
            </div>
            {market?.read ? (
              <>
                <p className="mt-3 max-w-3xl font-display text-2xl leading-snug sm:text-[28px]">{market.read.summary}</p>
                {market.read.themes.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {market.read.themes.map((t) => (
                      <Tag key={t} className="border-border text-foreground">
                        {t}
                      </Tag>
                    ))}
                  </div>
                )}
              </>
            ) : market?.items.length ? (
              <div className="mt-2 grid gap-x-8 md:grid-cols-2">
                {market.items.slice(0, 4).map((h) => (
                  <HeadlineLink key={h.id} h={h} />
                ))}
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-6 w-1/2" />
              </div>
            )}
            {worry && (
              <p className="mt-5 flex items-start gap-2 rounded-xl border border-loss/30 bg-loss/5 px-4 py-2.5 text-sm">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-loss" />
                <span>
                  Biggest worry in your shares: <span className="font-semibold">{worry.name}</span>{" "}
                  <span className="text-muted-foreground">({share(worry.weight)} of them)</span>
                </span>
              </p>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              Your stocks{" "}
              {companies.length > 0 && (
                <span className="font-normal normal-case">
                  · largest {companies.length} · {canHoverHint}
                </span>
              )}
            </h2>
            {companies.length === 0 ? (
              <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">No shares held right now. Once you have some, their news shows up here.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {companies.map((c) => (
                  <CompanyTile key={c.ticker} c={c} ai={ai} />
                ))}
              </div>
            )}
          </section>

          <LiveFeed feed={data.feed} />

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ExternalLink className="mt-0.5 size-3.5 shrink-0" />
            Headlines come from Google News. {ai ? `The AI (${data.ai.label}) sees only each company's name and its public headlines — never what you hold or how much. ` : ""}
            It can be wrong, and none of this is advice to buy or sell.
          </p>
        </>
      )}
    </div>
  );
}
