import { cn } from "@/lib/utils";

/**
 * The sources Dhan Drishti reads, with what each file brings in. `logo` is the icon each one
 * publishes on its own website (in /public/brokers; the trademarks are their owners'); `full`
 * logos carry their own background and fill the tile. The monogram is the fallback.
 */
export const SOURCES = [
  { id: "zerodha", name: "Zerodha", what: "Tradebook · holdings · tax P&L", color: "#387ED1", mark: "Z", logo: "/brokers/zerodha.svg" },
  { id: "dhan", name: "Dhan", what: "Transactions · P&L · holdings", color: "#1E9E77", mark: "D", logo: "/brokers/dhan.svg" },
  { id: "vested", name: "Vested", what: "US stocks · dividends", color: "#002852", mark: "V", logo: "/brokers/vested.svg", full: true },
  { id: "ibkr", name: "Interactive Brokers", what: "Activity statements", color: "#D81B2C", mark: "IB", logo: "/brokers/ibkr.png", full: true },
  { id: "binance", name: "Binance", what: "Crypto trade history", color: "#E8B30B", mark: "B", dark: true, logo: "/brokers/binance.png" },
  { id: "cas", name: "CAMS · KFintech", what: "Mutual fund statement (CAS)", color: "#2F6FDB", mark: "MF", logo: "/brokers/kfintech.png" },
  { id: "csv", name: "Any spreadsheet", what: "Your own CSV or Excel", color: "#3A3A42", mark: "⋯" },
] as const;

export type SourceId = (typeof SOURCES)[number]["id"];

export function BrokerMark({ id, size = 40, className }: { id: SourceId; size?: number; className?: string }) {
  const s = SOURCES.find((x) => x.id === id)!;
  if ("logo" in s && s.logo) {
    const full = "full" in s && s.full;
    return (
      <span aria-hidden className={cn("inline-grid shrink-0 place-items-center overflow-hidden rounded-[28%]", !full && "bg-white", className)} style={{ width: size, height: size }}>
        <img src={s.logo} alt="" className={cn("object-contain", full ? "size-full" : "size-[72%]")} draggable={false} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn("inline-grid shrink-0 place-items-center rounded-[28%] font-semibold tracking-tight", className)}
      style={{ width: size, height: size, backgroundColor: s.color, color: "dark" in s && s.dark ? "#16120a" : "#ffffff", fontSize: size * (s.mark.length > 1 ? 0.34 : 0.46) }}
    >
      {s.mark}
    </span>
  );
}

/** A mark with its name and what it brings — for the scrolling strip. */
export function SourceChip({ id }: { id: SourceId }) {
  const s = SOURCES.find((x) => x.id === id)!;
  return (
    <span className="flex shrink-0 items-center gap-3 rounded-2xl border bg-card px-4 py-3">
      <BrokerMark id={id} size={36} />
      <span>
        <span className="block text-sm font-semibold">{s.name}</span>
        <span className="block text-xs text-muted-foreground">{s.what}</span>
      </span>
    </span>
  );
}
