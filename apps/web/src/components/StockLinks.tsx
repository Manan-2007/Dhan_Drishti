import { Link } from "react-router-dom";
import { ArrowLeftRight, Briefcase, ChartCandlestick, Newspaper } from "lucide-react";
import { cn } from "@/lib/utils";

export type StockPlace = "holding" | "research" | "news" | "trades";

/** Where each view of one stock lives. News is only for listed shares — a fund or contract has none. */
export const stockHref = {
  holding: (id: string) => `/portfolio/security/${id}`,
  research: (id: string) => `/research/${id}`,
  news: (id: string) => `/news?stock=${encodeURIComponent(id)}`,
  trades: (id: string) => `/activity?stock=${encodeURIComponent(id)}`,
} as const;

const PLACES: { key: StockPlace; label: string; icon: typeof Briefcase }[] = [
  { key: "holding", label: "Your holding", icon: Briefcase },
  { key: "research", label: "Research", icon: ChartCandlestick },
  { key: "news", label: "News", icon: Newspaper },
  { key: "trades", label: "Trades", icon: ArrowLeftRight },
];

/**
 * The same stock, seen from every other page: your holding, its research, its news and its trades.
 * Leave out the page you're on (`here`).
 */
export function StockLinks({ id, here, assetClass, className }: { id: string; here?: StockPlace; assetClass?: string; className?: string }) {
  const places = PLACES.filter((p) => p.key !== here && (p.key !== "news" || !assetClass || assetClass === "equity"));
  return (
    <nav aria-label="This stock elsewhere" className={cn("flex flex-wrap gap-2", className)}>
      {places.map(({ key, label, icon: Icon }) => (
        <Link
          key={key}
          to={stockHref[key](id)}
          className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <Icon className="size-3.5" /> {label}
        </Link>
      ))}
    </nav>
  );
}
