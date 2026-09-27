import { cn } from "@/lib/utils";

/** One headline number with its label and an optional line under it. */
export function Stat({ label, value, sub, tone, title, className }: { label: string; value: string; sub?: string; tone?: "gain" | "loss"; title?: string; className?: string }) {
  return (
    <div className={cn("rounded-2xl border bg-card px-5 py-4", className)} title={title}>
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl", tone === "gain" && "text-gain", tone === "loss" && "text-loss")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
