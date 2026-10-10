import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Panel } from "@/components/kit/Panel";
import { Stat } from "@/components/kit/Stat";
import { Empty } from "@/components/kit/Empty";
import { Skeleton } from "@/components/ui/skeleton";
import { NoMatch, ScopeSelect } from "@/components/shell/ScopeSelect";
import { useFilter, useHoldings } from "@/lib/hooks";
import type { XrayFinding, XraySeverity } from "@/lib/api";
import { assetClassLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const SEV: Record<XraySeverity, { icon: typeof Info; dot: string; text: string; ring: string }> = {
  high: { icon: AlertOctagon, dot: "bg-loss", text: "text-loss", ring: "border-loss/40" },
  warn: { icon: AlertTriangle, dot: "bg-warning", text: "text-warning", ring: "border-warning/40" },
  info: { icon: Info, dot: "bg-muted-foreground", text: "text-muted-foreground", ring: "border-border" },
  good: { icon: CheckCircle2, dot: "bg-gain", text: "text-gain", ring: "border-gain/40" },
};
const GRADE_TONE: Record<string, string> = { Healthy: "text-gain", Fair: "text-primary", "Needs work": "text-warning", Fragile: "text-loss" };
const scoreColor = (n: number) => (n >= 75 ? "bg-gain" : n >= 55 ? "bg-primary" : n >= 35 ? "bg-warning" : "bg-loss");
const pct = (w: number) => `${(w * 100).toFixed(0)}%`;

/** Portfolio X-ray: one health score plus the plain-language risks in how your money is spread. */
export function Health() {
  const { scope, active } = useFilter();
  const { data, isLoading } = useHoldings(scope);

  if (isLoading) return <Skeleton className="h-72 rounded-2xl" />;
  const h = data?.health;
  const div = data?.diversification;
  if (!h || !h.available) {
    if (active) return <NoMatch />;
    return <Empty title="Nothing to x-ray yet" body="Once you hold some priced positions, their health read shows up here." />;
  }

  const counts = { high: h.findings.filter((f) => f.severity === "high").length, warn: h.findings.filter((f) => f.severity === "warn").length };
  const headline = counts.high > 0 ? `${counts.high} thing${counts.high === 1 ? "" : "s"} to look at` : counts.warn > 0 ? `${counts.warn} thing${counts.warn === 1 ? "" : "s"} to watch` : "Nothing pressing";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">A health read on how your money is spread — concentration, cash drag and asset-class balance. All worked out on your machine; none of it is advice.</p>
        <ScopeSelect />
      </div>

      {/* Score */}
      <Panel title="Portfolio health">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <p className="font-display text-6xl leading-none tracking-tight">
              {h.score}
              <span className="text-2xl text-muted-foreground">/100</span>
            </p>
            <p className={cn("mt-2 text-sm font-semibold", GRADE_TONE[h.grade])}>{h.grade}</p>
          </div>
          <div className="min-w-48 flex-1">
            <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
              <span>{headline}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-raised">
              <div className={cn("h-full rounded-full transition-all", scoreColor(h.score))} style={{ width: `${h.score}%` }} />
            </div>
          </div>
        </div>
      </Panel>

      {/* Findings */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">What the x-ray found</h2>
        {h.findings.map((f) => (
          <FindingRow key={f.id} f={f} />
        ))}
      </section>

      {/* Supporting metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Diversification" value={`${div?.score ?? 0}/100`} sub={div?.grade} />
        <Stat label="Effective holdings" value={div?.effectiveHoldings ? div.effectiveHoldings.toFixed(1) : "—"} sub={`${div?.positions ?? 0} priced`} />
        <Stat label="In cash" value={pct(h.cashWeight)} sub="of net worth" tone={h.cashWeight >= 0.15 ? "loss" : undefined} />
        <Stat label="Biggest class" value={h.topClass ? pct(h.topClass.weight) : "—"} sub={h.topClass ? assetClassLabel(h.topClass.key) : undefined} />
      </div>
    </div>
  );
}

function FindingRow({ f }: { f: XrayFinding }) {
  const sev = SEV[f.severity];
  const Icon = sev.icon;
  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border bg-card px-4 py-3.5", sev.ring)}>
      <Icon className={cn("mt-0.5 size-5 shrink-0", sev.text)} />
      <div className="min-w-0">
        <p className="font-semibold">{f.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{f.detail}</p>
      </div>
    </div>
  );
}
