import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  AreaSeries,
  BaselineSeries,
  CrosshairMode,
  LineSeries,
  LineStyle,
  TickMarkType,
  createSeriesMarkers,
  type IChartApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { compactMoney, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { byDay, themedChart } from "./theme";

const GAIN = "#3ec98a";
const LOSS = "#f2665e";
const MUTED = "#9c978c";
/** Green while `value` is at or above `against`, red below (green when there's nothing to compare). */
const GAINS = (value: number, against: number | undefined) => (against === undefined || value >= against ? GAIN : LOSS);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface StockPoint {
  time: string; // YYYY-MM-DD
  value: number;
}
export interface StockMarker {
  time: string;
  kind: "buy" | "sell";
  label?: string;
}

function parts(time: Time): [number, number, number] {
  if (typeof time === "string") return time.split("-").map(Number) as [number, number, number];
  if (typeof time === "number") {
    const d = new Date(time * 1000);
    return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  }
  return [time.year, time.month, time.day];
}
const longDate = (time: Time) => {
  const [y, m, d] = parts(time);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/**
 * A price-over-time chart the way trading apps draw one. The line and its solid fill are green
 * while above where the range started and red below it; hovering reads out the value, the change
 * since the start and the date. An optional dashed second line (e.g. money put in) and buy/sell
 * markers. Values are money in `currency` unless `format` says otherwise.
 */
export function StockChart({
  points,
  compare,
  compareLabel = "Put in",
  markers,
  height = 300,
  currency = "INR",
  format,
  label,
  measure = "start",
}: {
  points: StockPoint[];
  compare?: StockPoint[];
  compareLabel?: string;
  markers?: StockMarker[];
  height?: number;
  currency?: string;
  format?: (n: number) => string;
  /** What the line is, above the value ("Your investments"). */
  label?: string;
  /**
   * What "up" is measured against. "start": the first value — a share's price chart. "compare":
   * the dashed line at each point — a portfolio, where value above the money put in is a gain and
   * new money going in isn't.
   */
  measure?: "start" | "compare";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const reduceMotion = useReducedMotion();
  const data = useMemo(() => byDay(points), [points]);
  const compareData = useMemo(() => (compare ? byDay(compare) : null), [compare]);
  const fmt = format ?? ((n: number) => money(n, currency));
  const formatRef = useRef(format);
  formatRef.current = format; // callers pass inline functions; don't rebuild the chart for them
  const first = data[0]?.value ?? 0;
  const last = data[data.length - 1];
  const [hover, setHover] = useState<{ time: Time; value: number; compare: number | null } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || data.length < 2) return;
    const chart = themedChart(el);
    chartRef.current = chart;
    const span = (Date.parse(String(data[data.length - 1]!.time)) - Date.parse(String(data[0]!.time))) / 86_400_000;
    const longSpan = span > 120;
    chart.applyOptions({
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: "#4a4a52", width: 1, style: LineStyle.Solid, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.18, bottom: 0.08 } },
      localization: { priceFormatter: (p: number) => (formatRef.current ? formatRef.current(p) : compactMoney(p, currency)), timeFormatter: longDate },
      timeScale: {
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        tickMarkFormatter: (time: Time, type: TickMarkType) => {
          const [y, m, d] = parts(time);
          if (type === TickMarkType.Year) return String(y);
          if (type === TickMarkType.Month) return MONTHS[m - 1]!;
          return longSpan ? "" : `${d} ${MONTHS[m - 1]}`; // over months, day labels just clutter
        },
      },
    });

    if (compareData && compareData.length > 1) {
      const c = chart.addSeries(LineSeries, {
        color: MUTED,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      c.setData(compareData);
    }

    const autoscaleInfoProvider = (original: () => { priceRange: { minValue: number; maxValue: number } | null } | null) => {
      // Never zoom in so far that a ₹1 wiggle looks like a rally: at least 2% of the value, top to bottom.
      const res = original();
      if (!res?.priceRange) return res;
      const { minValue, maxValue } = res.priceRange;
      const mid = (minValue + maxValue) / 2;
      const minSpan = Math.abs(mid) * 0.02;
      if (maxValue - minValue >= minSpan || minSpan === 0) return res;
      return { ...res, priceRange: { minValue: mid - minSpan / 2, maxValue: mid + minSpan / 2 } };
    };
    const againstCompare = measure === "compare" && compareData && compareData.length > 1;
    const series = againstCompare
      ? chart.addSeries(AreaSeries, {
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerRadius: 5,
          crosshairMarkerBorderColor: "#0b0b0d",
          crosshairMarkerBorderWidth: 2,
          autoscaleInfoProvider,
        })
      : chart.addSeries(BaselineSeries, {
          baseValue: { type: "price", price: first },
          lineWidth: 2,
          topLineColor: GAIN,
          topFillColor1: `${GAIN}24`,
          topFillColor2: `${GAIN}24`, // same colour top and bottom: a solid tint, never a gradient
          bottomLineColor: LOSS,
          bottomFillColor1: `${LOSS}24`,
          bottomFillColor2: `${LOSS}24`,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerRadius: 5,
          crosshairMarkerBorderColor: "#0b0b0d",
          crosshairMarkerBorderWidth: 2,
          autoscaleInfoProvider,
        });
    if (againstCompare) {
      // Each point green while worth more than what went in, red while less.
      const put = new Map(compareData!.map((p) => [p.time as string, p.value]));
      series.setData(
        data.map((p) => {
          const c = GAINS(p.value, put.get(p.time as string));
          return { ...p, lineColor: c, topColor: `${c}24`, bottomColor: `${c}24` };
        }),
      );
    } else {
      series.setData(data);
      // The start line: what "up" and "down" are measured against.
      series.createPriceLine({ price: first, color: "#3a3a42", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
    }

    if (markers?.length) {
      const inRange = new Set(data.map((p) => p.time as string));
      const list: SeriesMarker<Time>[] = markers
        .filter((m) => inRange.has(m.time))
        .sort((a, b) => (a.time < b.time ? -1 : 1))
        .map((m) => ({
          time: m.time as Time,
          position: m.kind === "buy" ? "belowBar" : "aboveBar",
          shape: m.kind === "buy" ? "arrowUp" : "arrowDown",
          color: m.kind === "buy" ? GAIN : LOSS,
          text: m.label ?? (m.kind === "buy" ? "B" : "S"),
          size: 1,
        }));
      createSeriesMarkers(series, list);
    }

    const compareByTime = new Map((compareData ?? []).map((p) => [p.time as string, p.value]));
    const onMove = (param: MouseEventParams<Time>) => {
      const v = param.time ? (param.seriesData.get(series) as { value?: number } | undefined)?.value : undefined;
      if (!param.time || v === undefined) setHover(null);
      else setHover({ time: param.time, value: v, compare: compareByTime.get(param.time as string) ?? null });
    };
    chart.subscribeCrosshairMove(onMove);
    chart.timeScale().fitContent();
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
    };
  }, [data, compareData, markers, first, currency, measure]);

  if (data.length < 2) {
    return (
      <div style={{ height }} className="grid place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">
        Not enough history to draw yet.
      </div>
    );
  }

  const shown = hover ?? { time: last!.time, value: last!.value, compare: compareData?.[compareData.length - 1]?.value ?? null };
  const vsCompare = measure === "compare" && shown.compare !== null;
  const reference = vsCompare ? shown.compare! : first;
  const change = shown.value - reference;
  const pct = reference ? change / Math.abs(reference) : null;
  const up = change >= 0;
  return (
    <div className="relative">
      <div className="pointer-events-none mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {label && <span className="w-full text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>}
        <span className="text-2xl font-semibold tabular-nums">{fmt(shown.value)}</span>
        <span className={cn("text-sm font-semibold tabular-nums", up ? "text-gain" : "text-loss")}>
          {up ? "+" : "−"}
          {fmt(Math.abs(change))}
          {pct !== null && ` (${up ? "+" : "−"}${Math.abs(pct * 100).toFixed(2)}%)`}
        </span>
        <span className="text-xs text-muted-foreground">
          {vsCompare
            ? `${up ? "gain" : "loss"} on ${fmt(shown.compare!)} put in${hover ? ` · ${longDate(shown.time)}` : ""}`
            : hover
              ? longDate(shown.time)
              : `since ${longDate(data[0]!.time)}`}
        </span>
        {!vsCompare && shown.compare !== null && (
          <span className="text-xs text-muted-foreground">
            · {compareLabel} {fmt(shown.compare)}
          </span>
        )}
      </div>
      <motion.div initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
        <div ref={ref} style={{ height }} className="w-full" />
      </motion.div>
    </div>
  );
}
