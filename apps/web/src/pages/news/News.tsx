import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, ExternalLink, KeyRound, Loader2, ShieldAlert, Sparkles, Telescope } from "lucide-react";
import { Panel } from "@/components/kit/Panel";
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
        <span className={cn("block leading-snug group-hover/h:text-primary", dense ? "text-sm" : "text-[15px]")}>{h.title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {[h.source, `published ${ago(h.publishedAt)}`].filter(Boolean).join(" · ")}
        </span>
      </span>
    </a>
  );
}

function CompanyCard({ c, ai }: { c: NewsCompany; ai: boolean }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const read = c.read;
  const shown = open ? c.items : c.items.slice(0, 2);
  return (
    <motion.article layout={!reduce} className="rounded-2xl border bg-card p-5">
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
      ) : (
        <>
          {read ? (
            <div className="mt-3 space-y-3">
              <p className="text-[15px] leading-relaxed">{read.summary}</p>
              {read.risks.length > 0 && (
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
              {read.outlook && (
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-primary uppercase">
                    <Telescope className="size-3.5" /> Next few weeks
                  </p>
                  <p className="mt-1.5 text-sm text-muted-foreground">{read.outlook}</p>
                </div>
              )}
            </div>
          ) : (
            ai &&
            c.items.length > 0 && (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin text-primary" /> Reading the headlines…
              </p>
            )
          )}

          {c.items.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No news this week.</p>
          ) : (
            <div className="mt-3 border-t pt-2">
              {shown.map((h) => (
                <HeadlineLink key={h.id} h={h} tone={read?.tones[h.id]} dense />
              ))}
              {c.items.length > 2 && (
                <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                  {open ? "Show less" : `All ${c.items.length} headlines`}
                  <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
                </button>
              )}
            </div>
          )}
          {read && c.readAt && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Sparkles className="size-3" /> AI read · {read.confidence} confidence · {ago(c.readAt)}
            </p>
          )}
        </>
      )}
    </motion.article>
  );
}

type FeedFilter = "all" | "mine" | "market";

function LiveFeed({ feed }: { feed: FeedItem[] }) {
  const [filter, setFilter] = useState<FeedFilter>("all");
  const reduce = useReducedMotion();
  // Headlines that arrive while the page is open get marked new for a minute.
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

  const items = feed.filter((f) => (filter === "all" ? true : filter === "mine" ? f.companies.length > 0 : f.market));
  return (
    <Panel
      title="Live feed"
      action={
        <Segmented
          size="xs"
          ariaLabel="Which news"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "mine", label: "My stocks" },
            { value: "market", label: "Market" },
          ]}
        />
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet — headlines show up here as they come in.</p>
      ) : (
        <ul className="-mx-1">
          <AnimatePresence initial={false}>
            {items.map((f) => (
              <motion.li
                key={f.id}
                layout={!reduce}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className={cn("rounded-xl border border-transparent px-1 py-1", fresh.has(f.id) && "border-primary/30 bg-primary/5")}
              >
                <HeadlineLink h={f} tone={f.tone} />
                <div className="mb-1 ml-4 flex flex-wrap gap-1.5">
                  {fresh.has(f.id) && <Tag className="border-primary/40 text-primary">New</Tag>}
                  {f.companies.map((c) => (
                    <Tag key={c.securityId} className="border-border text-muted-foreground">
                      {c.symbol}
                    </Tag>
                  ))}
                  {f.market && <Tag className="border-border text-muted-foreground">Market</Tag>}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
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
          <Skeleton className="h-64 rounded-2xl lg:col-span-7" />
          <Skeleton className="h-64 rounded-2xl lg:col-span-5" />
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

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
            <section className="min-w-0 space-y-4 lg:col-span-7">
              <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                Your stocks {companies.length > 0 && <span className="font-normal normal-case">· largest {companies.length}</span>}
              </h2>
              {companies.length === 0 ? (
                <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">No shares held right now. Once you have some, their news shows up here.</p>
              ) : (
                companies.map((c) => <CompanyCard key={c.ticker} c={c} ai={ai} />)
              )}
            </section>
            <div className="min-w-0 lg:sticky lg:top-24 lg:col-span-5 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:rounded-2xl">
              <LiveFeed feed={data.feed} />
            </div>
          </div>

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
