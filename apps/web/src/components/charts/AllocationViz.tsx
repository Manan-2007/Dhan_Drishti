/**
 * Three small, dependency-free SVG visualizations for how a portfolio is spread, drawn in the
 * app's palette: a treemap (size = value), a two-level sunburst (asset class → sector), and a
 * net-worth composition waterfall. Every figure is passed in already derived — nothing is faked.
 */

// ---- Treemap (binary split: simple, stable, readable) -----------------------------------------

export interface TreemapItem {
  key: string;
  label: string;
  value: number;
  color: string;
  pct: number; // 0..1
}

interface Rect {
  item: TreemapItem;
  x: number;
  y: number;
  w: number;
  h: number;
}

function splitLayout(items: TreemapItem[], x: number, y: number, w: number, h: number, horizontal: boolean, out: Rect[]): void {
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
  const W = 1000;
  const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length === 0) return null;
  const rects: Rect[] = [];
  splitLayout(sorted, 0, 0, W, height, true, rects);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" aria-label="Holdings treemap" style={{ display: "block" }}>
      {rects.map((r) => {
        const big = r.w > 90 && r.h > 44;
        const mid = r.w > 60 && r.h > 28;
        return (
          <g key={r.item.key}>
            <rect x={r.x + 1.5} y={r.y + 1.5} width={Math.max(0, r.w - 3)} height={Math.max(0, r.h - 3)} rx={8} fill={r.item.color} opacity={0.92}>
              <title>{`${r.item.label} · ${(r.item.pct * 100).toFixed(1)}%`}</title>
            </rect>
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

export function Sunburst({ groups, size = 300 }: { groups: SunburstGroup[]; size?: number }) {
  const total = groups.reduce((s, g) => s + g.value, 0);
  if (total <= 0) return null;
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
    segments.push(<path key={`c-${g.label}`} d={arcPath(cx, cy, rInner, rMid, angle, gEnd)} fill={g.color} opacity={0.95}><title>{`${g.label} · ${((g.value / total) * 100).toFixed(1)}%`}</title></path>);
    // outer ring: this group's children within its angle
    const childTotal = g.children.reduce((s, c) => s + c.value, 0) || g.value;
    let ca = angle;
    const kids = g.children.length ? g.children : [{ label: g.label, color: g.color, value: g.value }];
    for (const c of kids) {
      const cSpan = (c.value / childTotal) * span;
      segments.push(<path key={`s-${g.label}-${c.label}`} d={arcPath(cx, cy, rMid + 2, rOuter, ca, ca + cSpan)} fill={c.color} opacity={0.82}><title>{`${c.label} · ${((c.value / total) * 100).toFixed(1)}%`}</title></path>);
      ca += cSpan;
    }
    angle = gEnd;
  }
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" height={size} role="img" aria-label="Asset-class and sector sunburst" style={{ display: "block" }}>
      {segments}
    </svg>
  );
}

// ---- Waterfall (net-worth composition) --------------------------------------------------------

export interface WaterfallStep {
  label: string;
  value: number;
  kind: "base" | "add" | "total";
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
