import type { Diversification } from "../lib/api.js";
import { Card, Badge } from "./ui.js";
import { compactMoney, pct } from "../lib/format.js";

const GRADE_TONE: Record<Diversification["grade"], "success" | "warning" | "danger" | "muted"> = {
  Excellent: "success",
  Good: "success",
  Fair: "warning",
  Concentrated: "danger",
};
const FLAG_STYLE: Record<string, { dot: string; text: string }> = {
  high: { dot: "bg-destructive", text: "text-foreground" },
  warn: { dot: "bg-warning", text: "text-foreground" },
  info: { dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
};

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono tabular text-lg">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function DiversificationCard({ data }: { data: Diversification }) {
  if (!data.available) return null;
  return (
    <Card className="mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Diversification health</h3>
          <p className="text-xs text-muted-foreground">How spread-out your invested money is, and where it's concentrated.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono tabular text-2xl">{data.score}</span>
          <span className="text-sm text-muted-foreground">/100</span>
          <Badge tone={GRADE_TONE[data.grade]}>{data.grade}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t pt-3 sm:grid-cols-4">
        <Metric label="Holdings" value={String(data.positions)} hint={`≈ ${data.effectiveHoldings.toFixed(1)} effective`} />
        <Metric label="Largest holding" value={data.top1 ? pct(data.top1.weight) : "—"} hint={data.top1 ? `${data.top1.label} · ${compactMoney(data.top1.value)}` : undefined} />
        <Metric label="Top 5 weight" value={pct(data.top5Weight)} />
        <Metric label="Biggest sector" value={data.topSector ? pct(data.topSector.weight) : "—"} hint={data.topSector?.label} />
      </div>

      {data.flags.length > 0 && (
        <ul className="mt-4 space-y-2 border-t pt-3 text-sm">
          {data.flags.map((f, i) => {
            const s = FLAG_STYLE[f.severity] ?? FLAG_STYLE.info!;
            return (
              <li key={i} className="flex items-start gap-2">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
                <span className={s.text}>{f.message}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
