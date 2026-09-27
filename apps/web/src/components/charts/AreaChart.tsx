import { useEffect, useRef } from "react";
import { AreaSeries, ColorType, CrosshairMode, createChart, type Time } from "lightweight-charts";
import { compactMoney } from "@/lib/format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Lightweight Charts hands business-day times back as "YYYY-MM-DD" strings or {year,month,day}. */
function dayLabel(time: Time, withYear = false): string {
  let y: number, m: number, d: number;
  if (typeof time === "string") [y, m, d] = time.split("-").map(Number) as [number, number, number];
  else if (typeof time === "number") {
    const dt = new Date(time * 1000);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else [y, m, d] = [time.year, time.month, time.day];
  return `${d} ${MONTHS[m - 1] ?? ""}${withYear ? ` ${y}` : ""}`;
}

export interface ChartPoint {
  time: string; // YYYY-MM-DD
  value: number;
}

/**
 * A price/value line over time (TradingView Lightweight Charts). The area under the line is ONE
 * solid tint — top and bottom colours are identical, so there is no gradient.
 */
export function AreaChart({ points, height = 260, color = "#f0b23e" }: { points: ChartPoint[]; height?: number; color?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9c978c",
        fontFamily: "IBM Plex Sans Variable, ui-sans-serif, system-ui",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: "#1d1d22" } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: {
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
        tickMarkFormatter: (time: Time) => dayLabel(time),
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: "#3a3a42", width: 1, style: 0, labelBackgroundColor: "#26262c" },
        horzLine: { color: "#3a3a42", width: 1, style: 2, labelBackgroundColor: "#26262c" },
      },
      handleScroll: false,
      handleScale: false,
      localization: { priceFormatter: (p: number) => compactMoney(p), timeFormatter: (time: Time) => dayLabel(time, true) },
    });
    const tint = `${color}1f`; // same colour, ~12% opacity, used for both edges of the fill
    const series = chart.addSeries(AreaSeries, {
      lineColor: color,
      lineWidth: 2,
      topColor: tint,
      bottomColor: tint,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerBorderColor: "#0b0b0d",
      crosshairMarkerBackgroundColor: color,
      // Never zoom the axis in so far that a ₹1 wiggle looks like a rally: show at least 2% of
      // the value from top to bottom.
      autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } | null } | null) => {
        const res = original();
        if (!res?.priceRange) return res;
        const { minValue, maxValue } = res.priceRange;
        const mid = (minValue + maxValue) / 2;
        const minSpan = Math.abs(mid) * 0.02;
        if (maxValue - minValue >= minSpan || minSpan === 0) return res;
        return { ...res, priceRange: { minValue: mid - minSpan / 2, maxValue: mid + minSpan / 2 } };
      },
    });
    // Lightweight Charts needs strictly ascending, unique times.
    const seen = new Map<string, number>();
    for (const p of points) seen.set(p.time, p.value);
    series.setData([...seen.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([time, value]) => ({ time: time as Time, value })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points, color]);

  return <div ref={ref} style={{ height }} className="w-full" />;
}
