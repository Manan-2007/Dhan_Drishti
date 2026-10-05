import { useEffect, useRef, useState } from "react";
import { useIndices } from "@/lib/hooks";
import type { IndexQuote } from "@/lib/api";
import { cn } from "@/lib/utils";

const value = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;
/** Each half repeats the set so the strip is always full, however wide the screen. */
const REPEAT = 4;

/** Which values just moved, and which way — for a brief flash. */
function useTicks(indices: IndexQuote[]) {
  const last = useRef(new Map<string, number>());
  const [ticks, setTicks] = useState<Record<string, "up" | "down">>({});
  useEffect(() => {
    const moved: Record<string, "up" | "down"> = {};
    for (const q of indices) {
      const before = last.current.get(q.id);
      if (before !== undefined && before !== q.value) moved[q.id] = q.value > before ? "up" : "down";
      last.current.set(q.id, q.value);
    }
    if (!Object.keys(moved).length) return;
    setTicks(moved);
    const t = setTimeout(() => setTicks({}), 900);
    return () => clearTimeout(t);
  }, [indices]);
  return ticks;
}

/**
 * Nifty 50, Bank Nifty and Sensex sliding past, refreshed every few seconds. Hover to hold it
 * still. Outside market hours it shows the last close and says so.
 */
export function IndexTicker({ region }: { region?: "in" | "us" } = {}) {
  const { data } = useIndices();
  // When a market is given, show that market's indices plus FX (USD/INR sits in both).
  const indices = (data?.indices ?? []).filter((q) => !region || q.region === region || q.region === "fx");
  const ticks = useTicks(indices);
  if (!data?.live || !indices.length) return null;

  const newest = Math.max(...indices.map((q) => Date.parse(q.asOf)));
  const open = Date.now() - newest < 5 * 60_000;
  const closedAt = new Date(newest).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

  const half = Array.from({ length: REPEAT }, (_, r) =>
    indices.map((q) => (
      <li key={`${r}-${q.id}`} className="flex shrink-0 items-baseline gap-2.5 px-6">
        <span className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">{q.name}</span>
        <span
          className={cn(
            "rounded-md px-1 text-[15px] font-semibold tabular-nums transition-colors duration-700",
            ticks[q.id] === "up" && "bg-gain/15 text-gain",
            ticks[q.id] === "down" && "bg-loss/15 text-loss",
          )}
        >
          {value(q.value)}
        </span>
        {q.changePct !== null && (
          <span className={cn("text-xs font-medium tabular-nums", q.changePct >= 0 ? "text-gain" : "text-loss")}>
            {q.changePct >= 0 ? "▲" : "▼"} {pct(q.changePct)}
          </span>
        )}
      </li>
    )),
  );

  return (
    <section aria-label="Market indices" className="group flex items-center overflow-hidden rounded-full border bg-card">
      <div className="z-10 flex shrink-0 items-center gap-2 border-r bg-card py-2.5 pr-4 pl-4">
        <span className="relative flex size-2">
          {open && <span className="absolute inline-flex size-full animate-ping rounded-full bg-gain opacity-60" />}
          <span className={cn("relative inline-flex size-2 rounded-full", open ? "bg-gain" : "bg-muted-foreground")} />
        </span>
        <span className="text-xs font-semibold tracking-[0.08em] uppercase">{open ? "Live" : "Closed"}</span>
        {!open && <span className="hidden text-xs text-muted-foreground sm:inline">· {closedAt}</span>}
      </div>
      {/* Screen readers get one plain copy; the moving strip is decoration. */}
      <ul className="sr-only">
        {indices.map((q) => (
          <li key={q.id}>
            {q.name} {value(q.value)}
            {q.changePct !== null ? `, ${pct(q.changePct)}` : ""}
          </li>
        ))}
      </ul>
      <div className="relative min-w-0 flex-1 overflow-hidden" aria-hidden>
        <div className="marquee-track flex w-max py-2.5 group-hover:[animation-play-state:paused]">
          <ul className="flex">{half}</ul>
          <ul className="flex">{half}</ul>
        </div>
      </div>
    </section>
  );
}
