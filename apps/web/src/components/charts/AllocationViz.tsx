/**
 * Three small, dependency-free SVG visualizations for how a portfolio is spread, drawn in the
 * app's palette: a treemap (size = value), a two-level sunburst (asset class → sector), and a
 * net-worth composition waterfall. Every figure is passed in already derived — nothing is faked.
 */

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface TipLine {
  text: string;
  tone?: "gain" | "loss";
}
interface Tip {
  x: number;
  y: number;
  flip: boolean;
  /** Open above the pointer (near the chart's bottom edge). */
  up: boolean;
  title: string;
  lines: TipLine[];
}

/** A hover card that follows the pointer over a chart (and opens on tap) — every tile's values,
 *  however small the tile. */
function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (e: React.MouseEvent, title: string, lines: TipLine[]) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    setTip({ x, y, flip: x > box.width - 230, up: y > box.height - 120, title, lines });
  };
  return { ref, tip, show, hide: () => setTip(null) };
}

function TipCard({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-30 max-w-60 min-w-36 rounded-xl border bg-popover px-3 py-2 text-xs shadow-[0_12px_32px_-8px_rgba(0,0,0,0.8)]"
      style={{
        ...(tip.up ? { bottom: `calc(100% - ${tip.y - 14}px)` } : { top: tip.y + 14 }),
        ...(tip.flip ? { right: `calc(100% - ${tip.x - 14}px)` } : { left: tip.x + 14 }),
      }}
    >
      <p className="text-sm font-semibold text-foreground">{tip.title}</p>
      {tip.lines.map((l, i) => (
        <p key={i} className={cn("mt-0.5 tabular-nums", l.tone === "gain" ? "text-gain" : l.tone === "loss" ? "text-loss" : "text-muted-foreground")}>
          {l.text}
        </p>
      ))}
    </div>
  );
}

// ---- Treemap (binary split: simple, stable, readable) -----------------------------------------

export interface TreemapItem {
  key: string;
  label: string;
  value: number;
  color: string;
  pct: number; // 0..1
  /** Shown on hover, e.g. the amount ("₹1.75 L"). */
  detail?: string;
}

interface Rect<T> {
  item: T;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Binary-split treemap layout, generic over anything with a positive `value`. */
function splitLayout<T extends { value: number }>(items: T[], x: number, y: number, w: number, h: number, horizontal: boolean, out: Rect<T>[]): void {
  if (items.length === 0) return;
  if (items.length === 1) {
    out.push({ item: items[0]!, x, y, w, h });
    return;
  }
  const total = items.reduce((s, i) => s + i.value, 0);
  const half = total / 2;
  let acc = 0;
  let i = 0;
  while (i < items.length - 1 && acc + items[i]!.value <= half) acc += items[i++]!.value;
  const a = items.slice(0, i + 1);
  const b = items.slice(i + 1);
  const fracA = acc + items[i]!.value > 0 ? (acc + items[i]!.value) / total : 0.5;
  if (horizontal) {
    const wa = w * fracA;
    splitLayout(a, x, y, wa, h, !horizontal, out);
    splitLayout(b, x + wa, y, w - wa, h, !horizontal, out);
  } else {
    const ha = h * fracA;
    splitLayout(a, x, y, w, ha, !horizontal, out);
    splitLayout(b, x, y + ha, w, h - ha, !horizontal, out);
  }
}

export function Treemap({ items, height = 300 }: { items: TreemapItem[]; height?: number }) {
  const { ref, tip, show, hide } = useTip();
  const W = 1000;
  const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length === 0) return null;
  const rects: Rect<TreemapItem>[] = [];
  splitLayout(sorted, 0, 0, W, height, true, rects);
  const lines = (it: TreemapItem): TipLine[] => [{ text: `${(it.pct * 100).toFixed(1)}% of the split` }, ...(it.detail ? [{ text: it.detail }] : [])];
  return (
    <div ref={ref} className="relative" onMouseLeave={hide}>
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" aria-label="Holdings treemap" style={{ display: "block" }}>
      {rects.map((r) => {
        const big = r.w > 90 && r.h > 44;
        const mid = r.w > 60 && r.h > 28;
        return (
          <g key={r.item.key} onMouseMove={(e) => show(e, r.item.label, lines(r.item))} onClick={(e) => show(e, r.item.label, lines(r.item))}>
            <rect x={r.x + 1.5} y={r.y + 1.5} width={Math.max(0, r.w - 3)} height={Math.max(0, r.h - 3)} rx={8} fill={r.item.color} opacity={tip?.title === r.item.label ? 1 : 0.92} />
            {mid && (
              <text x={r.x + 14} y={r.y + 26} fill="#16120a" fontSize={big ? 20 : 15} fontWeight={600} style={{ pointerEvents: "none" }}>
                {r.item.label.length > r.w / 10 ? `${r.item.label.slice(0, Math.max(3, Math.floor(r.w / 10)))}…` : r.item.label}
              </text>
            )}
            {big && (
              <text x={r.x + 14} y={r.y + 48} fill="#16120a" fontSize={14} opacity={0.8} style={{ pointerEvents: "none" }}>
                {(r.item.pct * 100).toFixed(1)}%
              </text>
            )}
          </g>
        );
      })}
    </svg>
    <TipCard tip={tip} />
    </div>
  );
}

// ---- Sunburst (two rings: asset class inner, its sectors outer) --------------------------------

export interface SunburstGroup {
  label: string;
  color: string;
  value: number;
  children: { label: string; color: string; value: number }[];
}

const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
function arcPath(cx: number, cy: number, rI: number, rO: number, a0: number, a1: number): string {
  if (a1 - a0 >= 359.999) a1 = a0 + 359.999; // avoid a full-circle degenerate arc
  const [x0, y0] = polar(cx, cy, rO, a1);
  const [x1, y1] = polar(cx, cy, rO, a0);
  const [x2, y2] = polar(cx, cy, rI, a0);
  const [x3, y3] = polar(cx, cy, rI, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0},${y0} A${rO},${rO} 0 ${large} 0 ${x1},${y1} L${x2},${y2} A${rI},${rI} 0 ${large} 1 ${x3},${y3} Z`;
}

export function Sunburst({ groups, size = 300, format }: { groups: SunburstGroup[]; size?: number; format?: (v: number) => string }) {
  const { ref, tip, show, hide } = useTip();
  const total = groups.reduce((s, g) => s + g.value, 0);
  if (total <= 0) return null;
  const lines = (value: number, parent?: string): TipLine[] => [
    { text: `${((value / total) * 100).toFixed(1)}% of your holdings` },
    ...(format ? [{ text: format(value) }] : []),
    ...(parent ? [{ text: `in ${parent}` }] : []),
  ];
  const cx = size / 2;
  const cy = size / 2;
  const rInner = size * 0.18;
  const rMid = size * 0.3;
  const rOuter = size * 0.46;
  let angle = 0;
  const segments: React.ReactNode[] = [];
  for (const g of groups) {
    const span = (g.value / total) * 360;
    const gEnd = angle + span;
    segments.push(<path key={`c-${g.label}`} d={arcPath(cx, cy, rInner, rMid, angle, gEnd)} fill={g.color} opacity={0.95} onMouseMove={(e) => show(e, g.label, lines(g.value))} onClick={(e) => show(e, g.label, lines(g.value))} />);
    // outer ring: this group's children within its angle
    const childTotal = g.children.reduce((s, c) => s + c.value, 0) || g.value;
    let ca = angle;
    const kids = g.children.length ? g.children : [{ label: g.label, color: g.color, value: g.value }];
    for (const c of kids) {
      const cSpan = (c.value / childTotal) * span;
      segments.push(<path key={`s-${g.label}-${c.label}`} d={arcPath(cx, cy, rMid + 2, rOuter, ca, ca + cSpan)} fill={c.color} opacity={0.82} onMouseMove={(e) => show(e, c.label, lines(c.value, g.label))} onClick={(e) => show(e, c.label, lines(c.value, g.label))} />);
      ca += cSpan;
    }
    angle = gEnd;
  }
  return (
    <div ref={ref} className="relative" onMouseLeave={hide}>
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" height={size} role="img" aria-label="Asset-class and sector sunburst" style={{ display: "block" }}>
        {segments}
      </svg>
      <TipCard tip={tip} />
    </div>
  );
}

// ---- Waterfall (net-worth composition) --------------------------------------------------------

export interface WaterfallStep {
  label: string;
  value: number;
  kind: "base" | "add" | "total";
}

// ---- Heatmap (today's movers: size = value, colour = daily change) ----------------------------

export interface HeatItem {
  key: string;
  label: string;
  value: number; // size (base-currency worth)
  changePct: number | null; // today's move, as a fraction (e.g. 0.012)
  /** Shown on hover: the company's name, and the worth ("₹23,728"). */
  name?: string;
  detail?: string;
}

/** Diverging fill: green for a gain, red for a loss, muted when flat/unknown. Intensity caps at ±3%. */
function heatFill(changePct: number | null): string {
  if (changePct === null) return "rgba(156,151,140,0.18)";
  const mag = Math.min(Math.abs(changePct) / 0.03, 1);
  const alpha = (0.2 + 0.65 * mag).toFixed(2);
  if (changePct > 0.0001) return `rgba(62,201,138,${alpha})`; // gain
  if (changePct < -0.0001) return `rgba(242,102,94,${alpha})`; // loss
  return "rgba(156,151,140,0.18)";
}

export function Heatmap({ items, height = 320 }: { items: HeatItem[]; height?: number }) {
  const { ref, tip, show, hide } = useTip();
  const W = 1000;
  const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length === 0) return null;
  const rects: Rect<HeatItem>[] = [];
  splitLayout(sorted, 0, 0, W, height, true, rects);
  const pct = (c: number | null) => (c === null ? "—" : `${c >= 0 ? "+" : "−"}${(Math.abs(c) * 100).toFixed(2)}%`);
  const lines = (it: HeatItem): TipLine[] => [
    ...(it.name && it.name !== it.label ? [{ text: it.name }] : []),
    { text: it.changePct === null ? "No move yet today" : `${pct(it.changePct)} today`, tone: it.changePct === null ? undefined : it.changePct >= 0 ? "gain" : "loss" },
    ...(it.detail ? [{ text: it.detail }] : []),
  ];
  return (
    <div ref={ref} className="relative" onMouseLeave={hide}>
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" aria-label="Today's movers heatmap" style={{ display: "block" }}>
      {rects.map((r) => {
        const big = r.w > 90 && r.h > 44;
        const mid = r.w > 56 && r.h > 26;
        return (
          <g key={r.item.key} onMouseMove={(e) => show(e, r.item.label, lines(r.item))} onClick={(e) => show(e, r.item.label, lines(r.item))}>
            <rect x={r.x + 1.5} y={r.y + 1.5} width={Math.max(0, r.w - 3)} height={Math.max(0, r.h - 3)} rx={8} fill={heatFill(r.item.changePct)} stroke={tip?.title === r.item.label ? "rgba(243,239,230,0.6)" : "rgba(243,239,230,0.08)"} />
            {mid && (
              <text x={r.x + 14} y={r.y + 25} fill="#f3efe6" fontSize={big ? 19 : 14} fontWeight={600} style={{ pointerEvents: "none" }}>
                {r.item.label.length > r.w / 10 ? `${r.item.label.slice(0, Math.max(3, Math.floor(r.w / 10)))}…` : r.item.label}
              </text>
            )}
            {big && (
              <text x={r.x + 14} y={r.y + 47} fill="#f3efe6" fontSize={14} opacity={0.85} style={{ pointerEvents: "none" }}>
                {pct(r.item.changePct)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
    <TipCard tip={tip} />
    </div>
  );
}

// ---- Diverging bars (winners & losers) --------------------------------------------------------

export interface DivergingRow {
  key: string;
  label: string;
  value: number; // +gain / −loss
}

export function DivergingBars({ rows, currency, format, rowH = 30, max }: { rows: DivergingRow[]; currency: string; format: (v: number, c: string) => string; rowH?: number; max?: number }) {
  const data = [...rows].filter((r) => Number.isFinite(r.value) && r.value !== 0).sort((a, b) => b.value - a.value);
  if (data.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No gains or losses to show yet.</p>;
  const peak = max ?? Math.max(...data.map((r) => Math.abs(r.value)), 1);
  const W = 1000;
  const labelW = 200;
  const valW = 150;
  const cx = labelW + (W - labelW - valW) / 2; // center axis
  const halfW = (W - labelW - valW) / 2 - 6;
  const H = data.length * rowH + 8;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Winners and losers" style={{ display: "block" }}>
      <line x1={cx} y1={4} x2={cx} y2={H - 4} stroke="rgba(243,239,230,0.15)" strokeWidth={1} />
      {data.map((r, i) => {
        const y = 4 + i * rowH;
        const w = (Math.abs(r.value) / peak) * halfW;
        const gain = r.value >= 0;
        const x = gain ? cx : cx - w;
        return (
          <g key={r.key}>
            <text x={labelW - 12} y={y + rowH / 2 + 4} fill="#f3efe6" fontSize={14} textAnchor="end">
              {r.label.length > 22 ? `${r.label.slice(0, 21)}…` : r.label}
            </text>
            <rect x={x} y={y + 4} width={Math.max(2, w)} height={rowH - 10} rx={4} fill={gain ? "#3ec98a" : "#f2665e"} opacity={0.9} />
            <text x={W - valW + 10} y={y + rowH / 2 + 4} fill={gain ? "#3ec98a" : "#f2665e"} fontSize={14} fontWeight={600}>
              {gain ? "+" : "−"}
              {format(Math.abs(r.value), currency)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Waterfall({ steps, currency, format, height = 260 }: { steps: WaterfallStep[]; currency: string; format: (v: number, c: string) => string; height?: number }) {
  const positives = steps.filter((s) => s.kind !== "total");
  const peak = Math.max(steps.find((s) => s.kind === "total")?.value ?? 0, positives.reduce((s, x) => s + x.value, 0), 1);
  const W = 1000;
  const padTop = 28;
  const padBottom = 40;
  const plotH = height - padTop - padBottom;
  const n = steps.length;
  const gap = 24;
  const barW = (W - gap * (n + 1)) / n;
  const yOf = (v: number) => padTop + plotH * (1 - v / peak);
  let cum = 0;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" aria-label="Net-worth composition" style={{ display: "block" }}>
      {steps.map((s, i) => {
        const x = gap + i * (barW + gap);
        let y: number;
        let h: number;
        let fill: string;
        if (s.kind === "total") {
          y = yOf(s.value);
          h = plotH * (s.value / peak);
          fill = "#f0b23e";
        } else {
          const bottom = cum;
          cum += s.value;
          y = yOf(cum);
          h = plotH * (s.value / peak);
          fill = s.kind === "base" ? "#5fb7a6" : "#8c8fe0";
        }
        return (
          <g key={s.label}>
            <rect x={x} y={y} width={barW} height={Math.max(2, h)} rx={6} fill={fill} opacity={0.9} />
            <text x={x + barW / 2} y={height - 20} fill="#9c978c" fontSize={14} textAnchor="middle">{s.label}</text>
            <text x={x + barW / 2} y={y - 8} fill="#f3efe6" fontSize={14} fontWeight={600} textAnchor="middle">{format(s.value, currency)}</text>
          </g>
        );
      })}
    </svg>
  );
}
