import { useEffect, useRef } from "react";
import { AreaSeries } from "lightweight-charts";
import { byDay, themedChart } from "./theme";

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
    const chart = themedChart(el);
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
    series.setData(byDay(points));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points, color]);

  return <div ref={ref} style={{ height }} className="w-full" />;
}
